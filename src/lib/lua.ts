/**
 * Lua scripting: one Lua 5.4 state (wasmoon, Lua compiled to WebAssembly) per
 * connected session. The state is created when the session opens, the world's
 * script file is run into it, and it is closed when the tab closes. Reloading
 * the script throws the state away and starts a fresh one.
 *
 * Everything a script can do goes through a `LuaHost`, which the store
 * implements per session. This module has no DOM or Electron dependencies so
 * it can be exercised under Node (scripts/test-lua.mjs) with a fake host.
 *
 * The API is a familiar subset of MUSHclient's, as globals and again under a
 * `world` table: Send, Execute, Note, ColourNote, Tell, ColourTell,
 * GetVariable/SetVariable/DeleteVariable/GetVariableList, AddTrigger/AddAlias/
 * AddTimer, Delete*, Enable*, EnableGroup, Is*, GetInfo, WorldName,
 * IsConnected, print, utils.timer, plus the trigger_flag/alias_flag/timer_flag,
 * sendto and error_code tables. See README.md for the list in words.
 */
import { LuaMultiReturn, type LuaEngine, type LuaFactory } from 'wasmoon';
import type { Trigger, Alias, Timer, World, SendTo } from '../../shared/types';
import { normalizeTrigger, normalizeAlias, normalizeTimer } from '../../shared/types';
import { substitute, patternError, type Match } from './automation';

/** A piece of a note line. Colours are CSS colours, '' or null for the default. */
export interface NoteSpan { text: string; fg: string | null; bg: string | null }

/** What the store gives a script to work with. */
export interface LuaHost {
  /** Send one line to the game, echoed like a trigger's send. */
  send(text: string): void;
  /** Run text as if typed: aliases, stacking and speedwalk apply. */
  execute(text: string): void;
  /** Post a finished line to the output pane. */
  note(spans: NoteSpan[], kind: 'note' | 'error'): void;
  getVariable(name: string): string | undefined;
  setVariable(name: string, value: string): void;
  deleteVariable(name: string): boolean;
  variableNames(): string[];
  /** The live world; `updateWorld` pushes an edited copy to the session and persists it. */
  world(): World;
  updateWorld(world: World): void;
  connected(): boolean;
}

export type ScriptKind = 'trigger' | 'alias' | 'timer';
export interface Scripted { name: string; script?: string; scriptBody?: string }

/* ---------- MUSHclient-style constants ---------- */

export const TRIGGER_FLAG = {
  Enabled: 1, OmitFromLog: 2, OmitFromOutput: 4, KeepEvaluating: 8, IgnoreCase: 16, RegularExpression: 32,
  ExpandVariables: 512, Replace: 1024, LowercaseWildcard: 2048, Temporary: 16384, OneShot: 32768,
};
export const ALIAS_FLAG = {
  Enabled: 1, IgnoreAliasCase: 32, OmitFromLogFile: 64, RegularExpression: 128, ExpandVariables: 512, Replace: 1024,
  AliasSpeedWalk: 2048, AliasQueue: 4096, AliasMenu: 8192, Temporary: 16384, OneShot: 32768,
};
export const TIMER_FLAG = { Enabled: 1, AtTime: 2, OneShot: 4, TimerSpeedWalk: 8, TimerNote: 16, ActiveWhenClosed: 32, Replace: 1024, Temporary: 16384 };
export const SENDTO = {
  world: 0, command: 1, output: 2, status: 3, notepad: 4, notepadappend: 5, logfile: 6, notepadreplace: 7,
  commandqueue: 8, variable: 9, execute: 10, speedwalk: 11, script: 12, immediate: 13, scriptafteromit: 14,
};
export const ERROR_CODE = {
  eOK: 0, eWorldOpen: 30001, eWorldClosed: 30002, eNoNameSpecified: 30003, eCannotPlaySound: 30004,
  eTriggerNotFound: 30005, eTriggerAlreadyExists: 30006, eTriggerCannotBeEmpty: 30007, eInvalidObjectLabel: 30008,
  eScriptNameNotLocated: 30009, eAliasNotFound: 30010, eAliasAlreadyExists: 30011, eAliasCannotBeEmpty: 30012,
  eTimerNotFound: 30017, eTimerAlreadyExists: 30018, eVariableNotFound: 30019, eBadRegularExpression: 30021,
  eTimeInvalid: 30022, eBadParameter: 30023, eUnknownOption: 30041,
};

/** MUSHclient's custom colours 1..16 on the ANSI palette (same table as the .MCL importer). */
const CUSTOM_COLOUR_ANSI = ['9', '10', '12', '11', '13', '14', '15', '1', '2', '4', '3', '5', '6', '7', '8', '0'];

/* ---------- the Lua side ---------- */

/** Names installed as globals and mirrored into the `world` table. */
const API_NAMES = [
  'Send', 'Execute', 'Note', 'ColourNote', 'Tell', 'ColourTell',
  'GetVariable', 'SetVariable', 'DeleteVariable', 'GetVariableList',
  'AddTrigger', 'AddTriggerEx', 'AddAlias', 'AddTimer', 'DeleteTrigger', 'DeleteAlias', 'DeleteTimer',
  'EnableTrigger', 'EnableAlias', 'EnableTimer', 'EnableGroup', 'EnableTriggerGroup', 'EnableAliasGroup', 'EnableTimerGroup',
  'IsTrigger', 'IsAlias', 'IsTimer', 'GetInfo', 'WorldName', 'IsConnected', 'Version',
];

const PRELUDE = `
world = {}
for _, k in ipairs(__lantern_names) do world[k] = _G[k] end
function print(...)
  local t = {}
  for i = 1, select('#', ...) do t[i] = tostring(select(i, ...)) end
  Note(table.concat(t, '\\t'))
end
world.print = print
utils = { timer = __lantern_timer }
function check(code)
  if code ~= 0 then error(('call failed with error code %s'):format(tostring(code)), 2) end
end

local function wild(caps, named)
  local w = {}
  if caps then for i, v in ipairs(caps) do w[i - 1] = v end end
  if named then for k, v in pairs(named) do w[k] = v end end
  return w
end

-- Call a named function as fn(name, line, wildcards). Returns nil, or an error message.
function __lantern_fire(fname, name, line, caps, named)
  local f = _G[fname]
  if type(f) ~= 'function' then return "no Lua function named '" .. tostring(fname) .. "'" end
  local ok, err = xpcall(f, debug.traceback, name, line, wild(caps, named))
  if not ok then return tostring(err) end
  return nil
end

-- Run inline code with ... = name, line, wildcards. Returns nil, or an error message.
function __lantern_run(code, chunk, name, line, caps, named)
  local f, err = load(code, chunk, 't')
  if not f then return tostring(err) end
  local ok, rerr = xpcall(f, debug.traceback, name, line, wild(caps, named))
  if not ok then return tostring(rerr) end
  return nil
end
`;

export interface LuaSessionOptions {
  /** Milliseconds a single call into Lua may run before it is stopped (default 5000). */
  timeoutMs?: number;
}

export class LuaSession {
  private engine: LuaEngine | null = null;
  private fireFn: ((...a: unknown[]) => unknown) | null = null;
  private runFn: ((...a: unknown[]) => unknown) | null = null;
  private pending: NoteSpan[] = [];   // Tell/ColourTell pieces waiting for a Note
  private started = performance.now();
  /** Non-null after `create` when the script file failed to load; the state still works. */
  loadError: string | null = null;

  private constructor(private host: LuaHost) {}

  get open() { return this.engine !== null; }

  /** Create a state, install the API, run `code` (the world's script file). Never throws for script errors; those become red notes. */
  static async create(factory: LuaFactory, host: LuaHost, code: string, opts: LuaSessionOptions = {}): Promise<LuaSession> {
    const sess = new LuaSession(host);
    const engine = await factory.createEngine({ functionTimeout: opts.timeoutMs ?? 5000, injectObjects: false, enableProxy: false });
    sess.engine = engine;
    const api = sess.api();
    for (const [k, fn] of Object.entries(api)) engine.global.set(k, fn);
    engine.global.set('__lantern_names', API_NAMES);
    engine.global.set('__lantern_timer', () => (performance.now() - sess.started) / 1000);
    engine.global.set('trigger_flag', TRIGGER_FLAG);
    engine.global.set('alias_flag', ALIAS_FLAG);
    engine.global.set('timer_flag', TIMER_FLAG);
    engine.global.set('sendto', SENDTO);
    engine.global.set('error_code', ERROR_CODE);
    await engine.doString(PRELUDE);
    sess.fireFn = engine.global.get('__lantern_fire');
    sess.runFn = engine.global.get('__lantern_run');
    if (code.trim()) sess.loadError = await sess.load(code);
    return sess;
  }

  /** Run the script file's text in the state. Returns the error message, or null. */
  private async load(code: string): Promise<string | null> {
    if (!this.engine) return 'Lua state is closed';
    try {
      await this.engine.doString(code);
      return null;
    } catch (e) {
      const msg = luaMessage(e);
      this.error(`script file: ${msg}`);
      return msg;
    }
  }

  /** A trigger, alias or timer fired: call its Lua function and/or run its inline Lua. */
  fire(kind: ScriptKind, item: Scripted, line: string, match: Match = { wildcards: [], named: {} }) {
    if (!this.engine) return;
    const label = `${kind} "${item.name || '(unnamed)'}"`;
    if (item.script) {
      let err: unknown;
      try { err = this.fireFn!(item.script, item.name, line, match.wildcards, match.named); }
      catch (e) { err = luaMessage(e); }
      if (err) this.error(`${label}, function ${item.script}: ${String(err)}`);
    }
    if (item.scriptBody) {
      // MUSHclient substitutes %1..%9 into the script text before running it.
      const code = substitute(item.scriptBody, match.wildcards);
      let err: unknown;
      try { err = this.runFn!(code, `=${label}`, item.name, line, match.wildcards, match.named); }
      catch (e) { err = luaMessage(e); }
      if (err) this.error(`${label}, inline script: ${String(err)}`);
    }
    this.flushTell();
  }

  /** Run a chunk of Lua typed or pasted by the user. Returns the error message, or null. */
  async run(code: string): Promise<string | null> {
    if (!this.engine) return 'Lua state is closed';
    try { await this.engine.doString(code); this.flushTell(); return null; }
    catch (e) { const msg = luaMessage(e); this.error(msg); return msg; }
  }

  dispose() {
    const e = this.engine;
    this.engine = null;
    this.fireFn = null;
    this.runFn = null;
    try { e?.global.close(); } catch { /* already closed */ }
  }

  /* ---------- helpers ---------- */

  private error(msg: string) {
    this.flushTell();
    this.host.note([{ text: `Lua: ${msg}`, fg: null, bg: null }], 'error');
  }

  private flushTell() {
    if (!this.pending.length) return;
    const spans = this.pending;
    this.pending = [];
    this.host.note(spans, 'note');
  }

  private api(): Record<string, (...args: any[]) => unknown> {
    const h = this.host;
    const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : String(v));
    const joinAll = (args: unknown[]) => args.map(str).join('');
    const colour = (c: unknown): string | null => { const s = str(c).trim(); return s ? s : null; };
    const triples = (args: unknown[]): NoteSpan[] => {
      const out: NoteSpan[] = [];
      for (let i = 0; i < args.length; i += 3) out.push({ fg: colour(args[i]), bg: colour(args[i + 1]), text: str(args[i + 2]) });
      return out;
    };
    const note = (spans: NoteSpan[]) => { const all = [...this.pending, ...spans]; this.pending = []; h.note(all, 'note'); };

    const find = <T extends { name: string }>(list: T[], name: string) => list.findIndex((x) => x.name === name && name !== '');
    const upsert = <T extends { name: string }>(list: T[], item: T): T[] => {
      const i = find(list, item.name);
      return i === -1 ? [...list, item] : list.map((x, k) => (k === i ? item : x));
    };
    const setEnabled = <T extends { name: string; enabled: boolean }>(key: 'triggers' | 'aliases' | 'timers', name: string, on: unknown, notFound: number) => {
      const w = h.world();
      const list = w[key] as unknown as T[];
      const i = find(list, str(name));
      if (i === -1) return notFound;
      h.updateWorld({ ...w, [key]: list.map((x, k) => (k === i ? { ...x, enabled: truthy(on) } : x)) });
      return 0;
    };
    const remove = (key: 'triggers' | 'aliases' | 'timers', name: string, notFound: number) => {
      const w = h.world();
      const list = w[key] as { name: string }[];
      if (find(list, str(name)) === -1) return notFound;
      h.updateWorld({ ...w, [key]: list.filter((x) => x.name !== str(name)) });
      return 0;
    };
    const enableGroup = (keys: ('triggers' | 'aliases' | 'timers')[], group: unknown, on: unknown) => {
      const w = h.world();
      const g = str(group);
      let count = 0;
      const next: World = { ...w };
      for (const key of keys) {
        (next as any)[key] = (w[key] as { group: string; enabled: boolean }[]).map((x) => {
          if (x.group !== g) return x;
          count++;
          return { ...x, enabled: truthy(on) };
        });
      }
      if (count) h.updateWorld(next);
      return count;
    };
    /** Where an added item's response goes: sendto.world (default), sendto.output, or sendto.script (it becomes inline Lua). */
    const sendToOf = (sendTo: unknown, response: string): { sendTo: SendTo; send: string; scriptBody?: string } => {
      const n = num(sendTo);
      if (n === SENDTO.script || n === SENDTO.scriptafteromit) return { sendTo: 'world', send: '', scriptBody: response };
      if (n === SENDTO.output) return { sendTo: 'output', send: response };
      return { sendTo: 'world', send: response };
    };

    const api: Record<string, (...args: any[]) => unknown> = {
      Send: (...args: unknown[]) => { for (const l of lines(joinAll(args))) h.send(l); return 0; },
      Execute: (...args: unknown[]) => { for (const l of lines(joinAll(args))) h.execute(l); return 0; },
      Note: (...args: unknown[]) => { note([{ text: joinAll(args), fg: null, bg: null }]); return 0; },
      ColourNote: (...args: unknown[]) => { note(triples(args)); return 0; },
      Tell: (...args: unknown[]) => { this.pending.push({ text: joinAll(args), fg: null, bg: null }); return 0; },
      ColourTell: (...args: unknown[]) => { this.pending.push(...triples(args)); return 0; },

      GetVariable: (name: unknown) => { const v = h.getVariable(str(name)); return v === undefined ? NIL() : v; },
      SetVariable: (name: unknown, value: unknown) => {
        const n = str(name);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return ERROR_CODE.eInvalidObjectLabel;
        h.setVariable(n, str(value)); return 0;
      },
      DeleteVariable: (name: unknown) => (h.deleteVariable(str(name)) ? 0 : ERROR_CODE.eVariableNotFound),
      GetVariableList: () => { const o: Record<string, string> = {}; for (const n of h.variableNames()) o[n] = h.getVariable(n) ?? ''; return o; },

      AddTrigger: (name: unknown, match: unknown, response: unknown, flags: unknown, colour: unknown, wildcard?: unknown, sound?: unknown, script?: unknown) =>
        api.AddTriggerEx(name, match, response, flags, colour, wildcard, sound, script, SENDTO.world),
      AddTriggerEx: (name: unknown, match: unknown, response: unknown, flags: unknown, colour: unknown, _wildcard: unknown, _sound: unknown, script: unknown, sendTo: unknown) => {
        const f = num(flags), pattern = str(match);
        if (!pattern) return ERROR_CODE.eTriggerCannotBeEmpty;
        const regex = !!(f & TRIGGER_FLAG.RegularExpression);
        if (regex && patternError(pattern, true)) return ERROR_CODE.eBadRegularExpression;
        const c = num(colour);
        const w = h.world();
        const t = normalizeTrigger({
          id: uid('t'), name: str(name), pattern, regex, enabled: !!(f & TRIGGER_FLAG.Enabled), ignoreCase: !!(f & TRIGGER_FLAG.IgnoreCase),
          gag: !!(f & TRIGGER_FLAG.OmitFromOutput), oneShot: !!(f & TRIGGER_FLAG.OneShot),
          highlight: c >= 1 && c <= 16 ? CUSTOM_COLOUR_ANSI[c - 1] : null, highlightLine: !regex,
          ...sendToOf(sendTo, str(response)),
          script: str(script) || undefined,
          temporary: f & TRIGGER_FLAG.Temporary ? true : undefined,
        });
        h.updateWorld({ ...w, triggers: upsert(w.triggers, t) });
        return 0;
      },
      AddAlias: (name: unknown, match: unknown, response: unknown, flags: unknown, script?: unknown) => {
        const f = num(flags), pattern = str(match);
        if (!pattern) return ERROR_CODE.eAliasCannotBeEmpty;
        const regex = !!(f & ALIAS_FLAG.RegularExpression);
        if (regex && patternError(pattern, true)) return ERROR_CODE.eBadRegularExpression;
        const w = h.world();
        const a = normalizeAlias({
          id: uid('a'), name: str(name), pattern, regex, enabled: !!(f & ALIAS_FLAG.Enabled), ignoreCase: !!(f & ALIAS_FLAG.IgnoreAliasCase),
          ...sendToOf(SENDTO.world, str(response)),
          script: str(script) || undefined,
          temporary: f & ALIAS_FLAG.Temporary ? true : undefined,
        });
        h.updateWorld({ ...w, aliases: upsert(w.aliases, a) });
        return 0;
      },
      AddTimer: (name: unknown, hour: unknown, minute: unknown, second: unknown, response: unknown, flags: unknown, script?: unknown) => {
        const f = num(flags);
        const hh = num(hour), mm = num(minute), ss = num(second);
        if (hh < 0 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return ERROR_CODE.eTimeInvalid;
        const atTime = !!(f & TIMER_FLAG.AtTime);
        if (atTime && hh > 23) return ERROR_CODE.eTimeInvalid;
        const every = hh * 3600 + mm * 60 + ss;
        if (!atTime && every <= 0) return ERROR_CODE.eTimeInvalid;
        const w = h.world();
        const t = normalizeTimer({
          id: uid('m'), name: str(name), enabled: !!(f & TIMER_FLAG.Enabled), oneShot: !!(f & TIMER_FLAG.OneShot),
          at: atTime ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : null,
          everySeconds: atTime ? 0 : every,
          send: str(response), sendTo: f & TIMER_FLAG.TimerNote ? 'output' : 'world',
          script: str(script) || undefined,
          temporary: f & TIMER_FLAG.Temporary ? true : undefined,
        });
        h.updateWorld({ ...w, timers: upsert(w.timers, t) });
        return 0;
      },
      DeleteTrigger: (name: unknown) => remove('triggers', str(name), ERROR_CODE.eTriggerNotFound),
      DeleteAlias: (name: unknown) => remove('aliases', str(name), ERROR_CODE.eAliasNotFound),
      DeleteTimer: (name: unknown) => remove('timers', str(name), ERROR_CODE.eTimerNotFound),
      EnableTrigger: (name: unknown, on: unknown = true) => setEnabled('triggers', str(name), on, ERROR_CODE.eTriggerNotFound),
      EnableAlias: (name: unknown, on: unknown = true) => setEnabled('aliases', str(name), on, ERROR_CODE.eAliasNotFound),
      EnableTimer: (name: unknown, on: unknown = true) => setEnabled('timers', str(name), on, ERROR_CODE.eTimerNotFound),
      EnableGroup: (group: unknown, on: unknown = true) => enableGroup(['triggers', 'aliases', 'timers'], group, on),
      EnableTriggerGroup: (group: unknown, on: unknown = true) => enableGroup(['triggers'], group, on),
      EnableAliasGroup: (group: unknown, on: unknown = true) => enableGroup(['aliases'], group, on),
      EnableTimerGroup: (group: unknown, on: unknown = true) => enableGroup(['timers'], group, on),
      IsTrigger: (name: unknown) => (find(h.world().triggers, str(name)) === -1 ? ERROR_CODE.eTriggerNotFound : 0),
      IsAlias: (name: unknown) => (find(h.world().aliases, str(name)) === -1 ? ERROR_CODE.eAliasNotFound : 0),
      IsTimer: (name: unknown) => (find(h.world().timers, str(name)) === -1 ? ERROR_CODE.eTimerNotFound : 0),

      GetInfo: (key: unknown) => {
        const w = h.world();
        switch (typeof key === 'number' ? key : str(key).toLowerCase()) {
          case 1: case 'host': return w.host;
          case 2: case 'name': return w.name;
          case 4: case 'port': return w.port;
          case 106: case 'connected': return h.connected();
          case 72: case 'version': return 'Lantern';
          case 'id': return w.id;
          default: return NIL();
        }
      },
      WorldName: () => h.world().name,
      IsConnected: () => h.connected(),
      Version: () => 'Lantern',
    };
    return api;
  }
}

/** An explicit Lua nil: a bare undefined return pushes nothing, which breaks tostring(GetVariable(x)). */
const NIL = () => new LuaMultiReturn(undefined);

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.length > 0);
}
function truthy(v: unknown) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'y'; }
function num(v: unknown) { const n = typeof v === 'number' ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
let seq = 0;
const uid = (prefix: string) => `lua-${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** A readable message out of whatever wasmoon threw. */
export function luaMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // wasmoon prefixes "[string "..."]:LINE:"; keep the line number but drop the noise.
  return raw.replace(/^\[string "[^"]*"\]:/, 'line ').replace(/^Lua Error\((\w+)\/\d+\):\s*/, '').trim() || 'unknown error';
}

export const _internal = { API_NAMES, PRELUDE };
