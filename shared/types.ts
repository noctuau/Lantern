/**
 * Types shared by the main process and the renderer: a world profile and the
 * automation it carries (triggers, aliases, timers). Pure data, no runtime deps.
 *
 * `script` on each item is the name of a Lua function stage 3 will call; it is
 * stored and shown but not executed yet. `scriptBody` keeps inline Lua pulled
 * from MUSHclient files so nothing is lost on import.
 */

export type SendTo = 'world' | 'output';

export interface Trigger {
  id: string;
  name: string;
  pattern: string;
  regex: boolean;          // false = plain text; "*" is a wildcard that captures %1..%9
  enabled: boolean;
  group: string;
  ignoreCase: boolean;
  send: string;            // text to send; %0 whole match, %1..%9 captures; one command per line
  sendTo: SendTo;          // where `send` goes: the game, or the output pane as a note
  highlight: string | null; // CSS colour ('#rrggbb' or a named colour) or '0'..'15' for the ANSI palette
  highlightLine: boolean;  // colour the whole line instead of just the matched text
  gag: boolean;            // omit the line from the output
  oneShot: boolean;        // disable itself after firing once
  script?: string;
  scriptBody?: string;
}

export interface Alias {
  id: string;
  name: string;
  pattern: string;
  regex: boolean;          // false = plain: "*" wildcards, or a prefix ("gg" matches "gg sword", %1 = "sword")
  enabled: boolean;
  group: string;
  ignoreCase: boolean;
  send: string;
  sendTo: SendTo;
  script?: string;
  scriptBody?: string;
}

export interface Timer {
  id: string;
  name: string;
  enabled: boolean;
  group: string;
  everySeconds: number;    // repeat interval; ignored when `at` is set
  at: string | null;       // 'HH:MM' or 'HH:MM:SS' local clock time, fires once a day
  send: string;
  sendTo: SendTo;
  oneShot: boolean;
  script?: string;
  scriptBody?: string;
}

export interface World {
  id: string;
  name: string;
  host: string;
  port: number;
  encoding: string;         // 'utf-8' | 'latin1'
  notes?: string;
  logging: boolean;
  /** Text sent automatically after connecting (e.g. "connect name password"). Plain text for now. */
  autoConnect?: string;
  createdAt: string;

  triggers: Trigger[];
  aliases: Alias[];
  timers: Timer[];

  /** Command stacking: "look;inv" sends two commands. Off by default. */
  commandStacking: boolean;
  commandStackChar: string;
  /** Speedwalk: "#3n2e" sends n n n e e. Off by default. */
  speedwalk: boolean;
  speedwalkPrefix: string;
}

export const DEFAULT_STACK_CHAR = ';';
export const DEFAULT_SPEEDWALK_PREFIX = '#';

/** Fill in anything a world loaded from disk (or an older version) is missing. */
export function normalizeWorld(w: Partial<World> & Pick<World, 'id'>): World {
  return {
    name: 'New world',
    host: '',
    port: 4000,
    encoding: 'utf-8',
    logging: true,
    createdAt: new Date().toISOString(),
    ...w,
    triggers: (w.triggers ?? []).map(normalizeTrigger),
    aliases: (w.aliases ?? []).map(normalizeAlias),
    timers: (w.timers ?? []).map(normalizeTimer),
    commandStacking: w.commandStacking ?? false,
    commandStackChar: w.commandStackChar || DEFAULT_STACK_CHAR,
    speedwalk: w.speedwalk ?? false,
    speedwalkPrefix: w.speedwalkPrefix || DEFAULT_SPEEDWALK_PREFIX,
  };
}

export function normalizeTrigger(t: Partial<Trigger> & Pick<Trigger, 'id'>): Trigger {
  return {
    name: '', pattern: '', regex: false, enabled: true, group: '', ignoreCase: false,
    send: '', sendTo: 'world', highlight: null, highlightLine: false, gag: false, oneShot: false,
    ...t,
  };
}

export function normalizeAlias(a: Partial<Alias> & Pick<Alias, 'id'>): Alias {
  return {
    name: '', pattern: '', regex: false, enabled: true, group: '', ignoreCase: true,
    send: '', sendTo: 'world',
    ...a,
  };
}

export function normalizeTimer(t: Partial<Timer> & Pick<Timer, 'id'>): Timer {
  return {
    name: '', enabled: true, group: '', everySeconds: 300, at: null, send: '', sendTo: 'world', oneShot: false,
    ...t,
  };
}
