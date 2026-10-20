/**
 * Session state: one entry per open connection. A tiny external store so the
 * high-frequency output path doesn't go through React state for every chunk.
 *
 * Automation lives here too: triggers run as each line is committed, and a
 * timer scheduler runs per connected session. Each session also owns a Lua
 * state (src/lib/lua.ts) that is created when the session is added, loaded
 * from the world's script file, and closed when the session is removed; the
 * store is the script's host (Send, Note, variables, AddTrigger, EnableGroup...).
 * Channel tabs (src/lib/channels.ts) are routed here too: after triggers, each
 * finished line is tested against the world's channel patterns and lands in the
 * main pane, a tab's own scrollback, both, or nowhere. The daily log is written
 * from here as well, line by line, so captured lines can carry their tab name.
 * Anything that has to leave the renderer (sending text, persisting a changed
 * world, reading the script file, logging) goes through `hooks`, which App wires up.
 */
import { useSyncExternalStore } from 'react';
import { AnsiParser, type Span } from './ansi';
import type { World, SendTo, Timer, ChannelTab } from '../../shared/types';
import { applyHighlights, splitSend, expandCommand, TimerScheduler, type Outgoing, type Match } from './automation';
import { classifyLine, logPrefix, type Route } from './channels';
import { lineHtml } from './loghtml';
import { LuaSession, type LuaHost, type NoteSpan, type Scripted, type ScriptKind } from './lua';
import { getLuaFactory } from './lua-wasm';

export type { World } from '../../shared/types';

export type LineKind = 'mud' | 'input' | 'note' | 'error';
export interface Line { id: number; kind: LineKind; spans: Span[]; ts: number; prompt?: boolean }

/** A channel tab's own scrollback. Scroll position and lock live in its OutputPane. */
export interface ChannelView { lines: Line[]; unread: number }

/** Which pane a session is showing: the main output or one channel tab (by id). */
export const MAIN_VIEW = 'main';

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
  view: string;          // MAIN_VIEW or a channel tab id
  channels: Record<string, ChannelView>;   // channel tab id → its lines
  mainUnread: number;    // game lines that reached the main pane while a channel tab was showing
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
  /** One finished line for the world's daily log (plain text, no newline). */
  log(sessionId: string, text: string, kind: 'output' | 'command' | 'note', html?: string): void;
}

const MAX_LINES = 10_000;
const MAX_CHANNEL_LINES = 5_000;
const MAX_SCRIPT_DEPTH = 8;
const PING_GAP_MS = 2000;

class Store {
  sessions = new Map<string, SessionState>();
  order: string[] = [];
  activeId: string | null = null;
  hooks: StoreHooks = { send() {}, worldChanged() {}, loadScript: async () => '', log() {} };
  private parsers = new Map<string, AnsiParser>();
  private timers = new Map<string, TimerScheduler>();
  private varSaves = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private lineId = 1;
  private snapshot = 0;
  private flushTimer: number | null = null;
  private lastPing = 0;
  private audio: AudioContext | null = null;

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
      view: MAIN_VIEW, channels: {}, mainUnread: 0,
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
    if (s) { s.unread = 0; this.markViewed(s); }
    this.notify();
  }

  /**
   * Show the main pane (MAIN_VIEW) or one channel tab. The input bar still talks to the game
   * whichever view is showing; a tab with a command prefix only changes what App.sendCommand
   * puts in front of the typed text.
   */
  setView(id: string, view: string) {
    const s = this.sessions.get(id); if (!s) return;
    if (view !== MAIN_VIEW && !s.world.channelTabs.some((t) => t.id === view && t.enabled)) view = MAIN_VIEW;
    s.view = view;
    this.markViewed(s);
    this.notify();
  }

  private markViewed(s: SessionState) {
    if (s.view === MAIN_VIEW) s.mainUnread = 0;
    else { const v = s.channels[s.view]; if (v) v.unread = 0; }
  }

  /** The channel tab's scrollback (empty until something lands there). */
  channel(id: string, tabId: string): ChannelView | undefined { return this.sessions.get(id)?.channels[tabId]; }

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
      // A tab that was deleted or disabled takes its pane with it; its lines stay in case it comes back.
      if (s.view !== MAIN_VIEW && !applied.channelTabs.some((t) => t.id === s.view && t.enabled)) { s.view = MAIN_VIEW; s.mainUnread = 0; }
      for (const tabId of Object.keys(s.channels)) if (!applied.channelTabs.some((t) => t.id === tabId)) delete s.channels[tabId];
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
    if (kind !== 'mud') { this.pushLine(s, { id: this.lineId++, kind, spans: merged, ts: Date.now(), prompt }); return; }

    // Triggers first (paused with the automation switch), then channel patterns (always on).
    const text = merged.map((sp) => sp.text).join('');
    let route: Route | null = null;
    const triggers = s.automation ? s.world.triggers : [];
    if (triggers.length || s.world.channelTabs.length) {
      const c = classifyLine(triggers, s.world.channelTabs, text);
      const r = c.triggers;
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
      }
      route = c.route;
    } else {
      route = { action: 'main', tab: null, pattern: null, showInMain: true, showInTab: false };
    }

    // The log records every line in order, gagged and silenced ones included, captured ones with their tab name.
    if (s.world.logging && s.world.log.output) {
      const prefix = logPrefix(route);
      this.hooks.log(s.id, prefix + text, 'output', s.world.log.format === 'html' ? lineHtml('output', prefix, merged) : undefined);
    }
    if (!route) return;   // gagged: shown nowhere, and never reaches a tab

    const line: Line = { id: this.lineId++, kind, spans: merged, ts: Date.now(), prompt };
    if (route.showInTab && route.tab) this.pushChannelLine(s, route.tab, line, !route.showInMain);
    if (route.showInMain) this.pushLine(s, line);
  }

  /** A captured line lands in its tab's scrollback; `countSession` adds it to the session tab's badge when the line is not also in main. */
  private pushChannelLine(s: SessionState, tab: ChannelTab, line: Line, countSession: boolean) {
    const v = s.channels[tab.id] ?? (s.channels[tab.id] = { lines: [], unread: 0 });
    v.lines.push(line);
    if (v.lines.length > MAX_CHANNEL_LINES) v.lines.splice(0, v.lines.length - MAX_CHANNEL_LINES);
    const viewing = s.id === this.activeId && s.view === tab.id;
    if (!viewing && tab.notify !== 'silent') {
      v.unread++;
      if (tab.notify === 'badge+sound') this.ping();
    }
    if (countSession && s.id !== this.activeId) s.unread++;
  }

  /** A short, quiet blip for tabs set to badge+sound; at most one every couple of seconds. */
  private ping() {
    const now = Date.now();
    if (now - this.lastPing < PING_GAP_MS || typeof AudioContext === 'undefined') return;
    this.lastPing = now;
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch { /* no audio device, or autoplay blocked: the badge still shows */ }
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
    if (line.kind === 'mud' && s.view !== MAIN_VIEW) s.mainUnread++;
  }

  note(id: string, text: string, kind: LineKind = 'note') {
    const s = this.sessions.get(id); if (!s) return;
    if (s.partial.length) this.commitPartial(s, 'mud');
    this.pushLine(s, { id: this.lineId++, kind, spans: [{ text, style: plain() }], ts: Date.now() });
    this.logNote(s, [{ text, style: plain() }]);
    this.scheduleNotify();
  }

  private logNote(s: SessionState, spans: Span[]) {
    if (!s.world.logging || !s.world.log.notes) return;
    const text = spans.map((x) => x.text).join('');
    this.hooks.log(s.id, text, 'note', s.world.log.format === 'html' ? lineHtml('note', '', spans) : undefined);
  }

  /** A note built from coloured pieces (ColourNote / ColourTell). */
  noteSpans(id: string, pieces: readonly NoteSpan[], kind: 'note' | 'error' = 'note') {
    const s = this.sessions.get(id); if (!s) return;
    if (s.partial.length) this.commitPartial(s, 'mud');
    const spans: Span[] = pieces.map((p) => ({ text: p.text, style: { ...plain(), fg: p.fg, bg: p.bg } }));
    this.pushLine(s, { id: this.lineId++, kind, spans: spans.length ? spans : [{ text: '', style: plain() }], ts: Date.now() });
    this.logNote(s, spans);
    this.scheduleNotify();
  }

  /**
   * Echo a command into the output. Typed commands also go into history; automated ones don't.
   * `typed` is what to remember when it differs from what was sent (a channel tab's command
   * prefix is echoed and logged, but ↑ recalls the words as typed so they are not prefixed twice).
   */
  input(id: string, text: string, remember = true, typed = text, echo = true) {
    const s = this.sessions.get(id); if (!s) return;
    // If a prompt line is pending, the command visually completes it.
    if (s.partial.length) this.commitPartial(s, 'mud', true);
    if (echo) {
      // The echo lands in the pane the command was typed from: a channel tab keeps its own
      // conversation together, and the main RP pane stays free of OOC chatter.
      const line: Line = { id: this.lineId++, kind: 'input', spans: [{ text, style: plain() }], ts: Date.now() };
      const tab = s.view !== MAIN_VIEW ? s.world.channelTabs.find((t) => t.id === s.view && t.enabled) : undefined;
      if (tab) this.pushChannelLine(s, tab, line, false);
      else this.pushLine(s, line);
    }
    if (s.world.logging && s.world.log.commands) this.hooks.log(id, `> ${text}`, 'command', s.world.log.format === 'html' ? lineHtml('command', '', [{ text, style: plain() }]) : undefined);
    if (remember && typed.trim() && s.history[s.history.length - 1] !== typed) {
      s.history.push(typed);
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
