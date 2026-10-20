/**
 * Session state: one entry per open connection. A tiny external store so the
 * high-frequency output path doesn't go through React state for every chunk.
 *
 * Automation lives here too: triggers run as each line is committed, and a
 * timer scheduler runs per connected session. Each session also owns a Lua
 * state (src/lib/lua.ts) that is created when the session is added, loaded
 * from the world's script file, and closed when the session is removed; the
 * store is the script's host (Send, Note, variables, AddTrigger, EnableGroup...).
 * Anything that has to leave the renderer (sending text, persisting a changed
 * world, reading the script file) goes through `hooks`, which App wires up.
 */
import { useSyncExternalStore } from 'react';
import { AnsiParser, type Span } from './ansi';
import type { World, SendTo, Timer } from '../../shared/types';
import { runTriggers, applyHighlights, splitSend, expandCommand, TimerScheduler, type Outgoing, type Match } from './automation';
import { LuaSession, type LuaHost, type NoteSpan, type Scripted, type ScriptKind } from './lua';
import { getLuaFactory } from './lua-wasm';

export type { World } from '../../shared/types';

export type LineKind = 'mud' | 'input' | 'note' | 'error';
export interface Line { id: number; kind: LineKind; spans: Span[]; ts: number; prompt?: boolean }

export interface SessionState {
  id: string;
  world: World;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  statusMessage?: string;
  lines: Line[];
  partial: Span[];       // the current unfinished line (usually the prompt)
  echo: boolean;         // false while the server is masking input (password)
  history: string[];
  unread: number;
  connectedAt?: number;
  gmcp: Record<string, unknown>;
  automation: boolean;   // master switch for triggers/timers on this session
  fired: number;         // triggers fired this session (status bar)
  lua: LuaSession | null;
  luaStatus: 'starting' | 'ready' | 'error' | 'failed';
  luaGen: number;        // bumps on every (re)load so a stale load can't install itself
  scriptDepth: number;   // nested script calls (Execute → alias → script → Execute …)
}

export interface StoreHooks {
  /** Send text produced by a trigger, alias or timer to the game. */
  send(sessionId: string, text: string): void;
  /** A world changed from inside the store (e.g. a one-shot trigger disabled itself): persist it. */
  worldChanged(world: World): void;
  /** The text of the world's Lua script file ('' when there is none). */
  loadScript(worldId: string): Promise<string>;
}

const MAX_LINES = 10_000;
const MAX_SCRIPT_DEPTH = 8;

class Store {
  sessions = new Map<string, SessionState>();
  order: string[] = [];
  activeId: string | null = null;
  hooks: StoreHooks = { send() {}, worldChanged() {}, loadScript: async () => '' };
  private parsers = new Map<string, AnsiParser>();
  private timers = new Map<string, TimerScheduler>();
  private varSaves = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private lineId = 1;
  private snapshot = 0;
  private flushTimer: number | null = null;

  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  getSnapshot = () => this.snapshot;

  private notify() {
    this.snapshot++;
    for (const l of this.listeners) l();
  }
  /** Coalesce bursts of output into one render per animation frame. */
  private scheduleNotify() {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.requestAnimationFrame(() => { this.flushTimer = null; this.notify(); });
  }

  add(id: string, world: World) {
    const s: SessionState = {
      id, world, status: 'connecting', lines: [], partial: [], echo: true, history: [], unread: 0, gmcp: {},
      automation: true, fired: 0, lua: null, luaStatus: 'starting', luaGen: 0, scriptDepth: 0,
    };
    this.sessions.set(id, s);
    this.parsers.set(id, new AnsiParser());
    this.order.push(id);
    this.activeId = id;
    this.notify();
    void this.startLua(s);
  }

  remove(id: string) {
    this.stopTimers(id);
    const s = this.sessions.get(id);
    if (s) { s.luaGen++; s.lua?.dispose(); s.lua = null; }
    const pending = this.varSaves.get(id);
    if (pending) { clearTimeout(pending); this.varSaves.delete(id); if (s) this.hooks.worldChanged(s.world); }
    this.sessions.delete(id);
    this.parsers.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.activeId === id) this.activeId = this.order[this.order.length - 1] ?? null;
    this.notify();
  }

  setActive(id: string) {
    this.activeId = id;
    const s = this.sessions.get(id);
    if (s) s.unread = 0;
    this.notify();
  }

  get(id: string) { return this.sessions.get(id); }
  active() { return this.activeId ? this.sessions.get(this.activeId) : undefined; }

  setStatus(id: string, status: SessionState['status'], message?: string) {
    const s = this.sessions.get(id); if (!s) return;
    s.status = status; s.statusMessage = message;
    if (status === 'connected') s.connectedAt = Date.now();
    const text = status === 'connected' ? `Connected to ${s.world.host}:${s.world.port}`
      : status === 'connecting' ? `Connecting to ${s.world.host}:${s.world.port}…`
      : status === 'error' ? `Connection error: ${message ?? 'unknown'}`
      : 'Disconnected.';
    this.note(id, text, status === 'error' ? 'error' : 'note');
    if (status === 'connected') this.startTimers(s);
    else if (status === 'disconnected' || status === 'error') this.stopTimers(id);
  }

  setEcho(id: string, on: boolean) { const s = this.sessions.get(id); if (s) { s.echo = on; this.notify(); } }

  setGmcp(id: string, pkg: string, data: unknown) {
    const s = this.sessions.get(id); if (!s) return;
    s.gmcp[pkg] = data; this.scheduleNotify();
  }

  /**
   * The world was edited (automation panel, world editor, a script): every session on it picks up
   * the change. A live session's script variables and temporary items are kept over the incoming
   * copy, which may have been cloned before a script changed them. Returns the world as applied.
   */
  updateWorld(world: World): World {
    let applied = world;
    for (const s of this.sessions.values()) {
      if (s.world.id !== world.id) continue;
      const keepTemp = <T extends { id: string; temporary?: boolean }>(incoming: T[], live: T[]) =>
        [...incoming, ...live.filter((x) => x.temporary && !incoming.some((y) => y.id === x.id))];
      applied = {
        ...world,
        variables: s.world.variables,
        triggers: keepTemp(world.triggers, s.world.triggers),
        aliases: keepTemp(world.aliases, s.world.aliases),
        timers: keepTemp(world.timers, s.world.timers),
      };
      s.world = applied;
      if (s.status === 'connected') this.startTimers(s);
    }
    this.notify();
    return applied;
  }

  setAutomation(id: string, on: boolean) {
    const s = this.sessions.get(id); if (!s) return;
    s.automation = on;
    if (on && s.status === 'connected') this.startTimers(s); else this.stopTimers(id);
    this.note(id, on ? 'Triggers and timers on.' : 'Triggers and timers paused.');
  }

  /** Text from the MUD. */
  text(id: string, chunk: string) {
    const s = this.sessions.get(id); const p = this.parsers.get(id);
    if (!s || !p) return;
    for (const tok of p.feed(chunk)) {
      if (tok.type === 'text') s.partial.push(tok.span);
      else this.commitPartial(s, 'mud');
    }
    this.scheduleNotify();
  }

  /** EOR/GA: the partial line is a prompt. Keep it visible but mark it. */
  prompt(id: string) {
    const s = this.sessions.get(id); if (!s) return;
    if (s.partial.length) {
      this.commitPartial(s, 'mud', true);
      this.scheduleNotify();
    }
  }

  private commitPartial(s: SessionState, kind: LineKind, prompt = false) {
    let merged = mergeSpans(s.partial);
    s.partial = [];

    if (kind === 'mud' && s.automation && s.world.triggers.length) {
      const text = merged.map((sp) => sp.text).join('');
      const r = runTriggers(s.world.triggers, text);
      if (r.fired.length) {
        s.fired += r.fired.length;
        if (r.highlights.length) merged = applyHighlights(merged, r.highlights);
        // Sends, notes and scripts run after this line is in place, so echoes land below it.
        if (r.outgoing.length) queueMicrotask(() => this.dispatch(s.id, r.outgoing));
        const scripted = r.matches.filter((m) => m.trigger.script || m.trigger.scriptBody);
        if (scripted.length) queueMicrotask(() => { for (const m of scripted) this.fireScript(s, 'trigger', m.trigger, text, m.match); });
        const spent = r.fired.filter((t) => t.oneShot);
        if (spent.length) {
          const ids = new Set(spent.map((t) => t.id));
          const world = { ...s.world, triggers: s.world.triggers.map((t) => (ids.has(t.id) ? { ...t, enabled: false } : t)) };
          this.updateWorld(world);
          this.hooks.worldChanged(world);
        }
        if (r.gag) return;
      }
    }

    this.pushLine(s, { id: this.lineId++, kind, spans: merged, ts: Date.now(), prompt });
  }

  /** Output from a trigger, alias, timer or script: to the game (echoed, not in history) or to the pane as a note. */
  dispatch(id: string, items: readonly Outgoing[]) { this.sendOutgoing(id, items, true); }

  private sendOutgoing(id: string, items: readonly Outgoing[], echo: boolean) {
    const s = this.sessions.get(id); if (!s) return;
    for (const it of items) {
      if (it.sendTo === 'output') { this.note(id, it.text); continue; }
      if (s.status !== 'connected') continue;
      if (echo && s.echo) this.input(id, it.text, false);
      this.hooks.send(id, it.text);
    }
  }

  /**
   * A command on its way to the game: aliases, stacking and speedwalk apply, then alias scripts run.
   * `echo` is false for typed commands (App has already echoed what was typed) and true for
   * a script's Execute, whose expansion is shown like a trigger's send.
   */
  execute(id: string, text: string, echo: boolean) {
    const s = this.sessions.get(id); if (!s) return;
    const { outgoing, matches } = expandCommand(s.world, text);
    this.sendOutgoing(id, outgoing, echo);
    for (const m of matches) if (m.alias.script || m.alias.scriptBody) this.fireScript(s, 'alias', m.alias, m.command, m.match);
  }

  private startTimers(s: SessionState) {
    this.stopTimers(s.id);
    if (!s.automation) return;
    const live = s.world.timers.filter((t) => t.enabled && (t.at || t.everySeconds > 0));
    if (!live.length) return;
    const sched = new TimerScheduler((t: Timer) => this.fireTimer(s.id, t));
    sched.start(live);
    this.timers.set(s.id, sched);
  }

  private stopTimers(id: string) {
    this.timers.get(id)?.stop();
    this.timers.delete(id);
  }

  private fireTimer(id: string, t: Timer) {
    const s = this.sessions.get(id); if (!s || s.status !== 'connected') return;
    s.fired++;
    if (t.send) this.dispatch(id, splitSend(t.send).map((text) => ({ text, sendTo: t.sendTo })));
    this.fireScript(s, 'timer', t, '');
    if (t.oneShot) {
      const world = { ...s.world, timers: s.world.timers.map((x) => (x.id === t.id ? { ...x, enabled: false } : x)) };
      this.updateWorld(world);
      this.hooks.worldChanged(world);
    }
  }

  /* ---------- Lua ---------- */

  /** (Re)create the session's Lua state from the world's script file. */
  private async startLua(s: SessionState) {
    const gen = ++s.luaGen;
    s.lua?.dispose(); s.lua = null;
    s.luaStatus = 'starting';
    let code = '';
    try { code = await this.hooks.loadScript(s.world.id); }
    catch (e) { this.note(s.id, `Could not read the script file: ${(e as Error).message}`, 'error'); }
    let lua: LuaSession;
    try { lua = await LuaSession.create(getLuaFactory(), this.luaHost(s), code); }
    catch (e) {
      if (gen !== s.luaGen) return;
      s.luaStatus = 'failed';
      this.note(s.id, `Lua could not start: ${(e as Error).message}`, 'error');
      return;
    }
    if (gen !== s.luaGen || !this.sessions.has(s.id)) { lua.dispose(); return; }
    s.lua = lua;
    s.luaStatus = lua.loadError ? 'error' : 'ready';
    if (code.trim() && !lua.loadError) this.note(s.id, `Script loaded (${code.split('\n').length} lines).`);
    this.scheduleNotify();
  }

  /** The Script tab saved or asked for a reload: every session on the world starts a fresh state. */
  reloadLua(worldId: string) {
    for (const s of this.sessions.values()) if (s.world.id === worldId) void this.startLua(s);
  }

  /** Run a chunk of Lua in a session (the Script tab's "run" box, or a `/lua` command later). */
  async runLua(id: string, code: string) {
    const s = this.sessions.get(id); if (!s) return;
    if (!s.lua) { this.note(id, 'Lua is not running for this session.', 'error'); return; }
    await s.lua.run(code);
    this.scheduleNotify();
  }

  private fireScript(s: SessionState, kind: ScriptKind, item: Scripted, line: string, match?: Match) {
    if (!s.lua || (!item.script && !item.scriptBody)) return;
    if (s.scriptDepth >= MAX_SCRIPT_DEPTH) {
      this.note(s.id, `Lua: ${kind} "${item.name}" not run: scripts are nested too deeply (an alias whose script runs itself?).`, 'error');
      return;
    }
    s.scriptDepth++;
    try { s.lua.fire(kind, item, line, match); }
    finally { s.scriptDepth--; }
    this.scheduleNotify();
  }

  private luaHost(s: SessionState): LuaHost {
    return {
      send: (text) => this.dispatch(s.id, [{ text, sendTo: 'world' }]),
      execute: (text) => this.execute(s.id, text, true),
      note: (spans, kind) => this.noteSpans(s.id, spans, kind),
      getVariable: (name) => s.world.variables[name],
      setVariable: (name, value) => { s.world.variables[name] = value; this.persistVariables(s); },
      deleteVariable: (name) => {
        if (!(name in s.world.variables)) return false;
        delete s.world.variables[name];
        this.persistVariables(s);
        return true;
      },
      variableNames: () => Object.keys(s.world.variables).sort(),
      world: () => s.world,
      updateWorld: (w) => { this.hooks.worldChanged(this.updateWorld(w)); },
      connected: () => s.status === 'connected',
    };
  }

  /** Variables change in place; write the world a moment later so a busy script doesn't save on every call. */
  private persistVariables(s: SessionState) {
    const prev = this.varSaves.get(s.id);
    if (prev) clearTimeout(prev);
    this.varSaves.set(s.id, setTimeout(() => {
      this.varSaves.delete(s.id);
      if (this.sessions.has(s.id)) this.hooks.worldChanged(s.world);
    }, 300));
  }

  private pushLine(s: SessionState, line: Line) {
    s.lines.push(line);
    if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
    if (s.id !== this.activeId) s.unread++;
  }

  note(id: string, text: string, kind: LineKind = 'note') {
    const s = this.sessions.get(id); if (!s) return;
    if (s.partial.length) this.commitPartial(s, 'mud');
    this.pushLine(s, { id: this.lineId++, kind, spans: [{ text, style: plain() }], ts: Date.now() });
    this.scheduleNotify();
  }

  /** A note built from coloured pieces (ColourNote / ColourTell). */
  noteSpans(id: string, pieces: readonly NoteSpan[], kind: 'note' | 'error' = 'note') {
    const s = this.sessions.get(id); if (!s) return;
    if (s.partial.length) this.commitPartial(s, 'mud');
    const spans: Span[] = pieces.map((p) => ({ text: p.text, style: { ...plain(), fg: p.fg, bg: p.bg } }));
    this.pushLine(s, { id: this.lineId++, kind, spans: spans.length ? spans : [{ text: '', style: plain() }], ts: Date.now() });
    this.scheduleNotify();
  }

  /** Echo a command into the output. Typed commands also go into history; automated ones don't. */
  input(id: string, text: string, remember = true) {
    const s = this.sessions.get(id); if (!s) return;
    // If a prompt line is pending, the command visually completes it.
    if (s.partial.length) this.commitPartial(s, 'mud', true);
    this.pushLine(s, { id: this.lineId++, kind: 'input', spans: [{ text, style: plain() }], ts: Date.now() });
    if (remember && text.trim() && s.history[s.history.length - 1] !== text) {
      s.history.push(text);
      if (s.history.length > 500) s.history.shift();
    }
    this.scheduleNotify();
  }
}

function plain() {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false };
}

function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (last && sameStyle(last.style, sp.style)) last.text += sp.text;
    else out.push({ text: sp.text, style: sp.style });
  }
  return out;
}

function sameStyle(a: Span['style'], b: Span['style']) {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic
    && a.underline === b.underline && a.strike === b.strike && a.inverse === b.inverse;
}

export const store = new Store();

export function useStore() {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return store;
}
