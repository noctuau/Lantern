/**
 * Types shared by the main process and the renderer: a world profile and the
 * automation it carries (triggers, aliases, timers). Pure data, no runtime deps.
 *
 * `script` on each item is the name of a Lua function called when it fires, as
 * fn(name, line, wildcards). `scriptBody` is inline Lua run when it fires (what
 * MUSHclient calls "send to script"; %1..%9 are substituted into the text first,
 * and `...` carries name, line, wildcards). Items a script adds with the
 * Temporary flag are marked `temporary` and never written to disk.
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
  highlight: string | null; // text colour: CSS colour ('#rrggbb' or a name) or '0'..'15' for the ANSI palette
  highlightBg: string | null;  // optional background colour, same forms
  highlightLine: boolean;  // colour the whole line instead of just the matched text
  gag: boolean;            // omit the line from the output
  oneShot: boolean;        // disable itself after firing once
  script?: string;
  scriptBody?: string;
  temporary?: boolean;
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
  temporary?: boolean;
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
  temporary?: boolean;
}

/**
 * A channel tab: a capture pane beside the main output. Every finished line is
 * tested against each tab's patterns (tabs in order, patterns in order, after
 * triggers); the first match decides where the line goes. See docs/channel-tabs.md.
 */
export interface ChannelTab {
  id: string;
  name: string;              // shown on the sub-tab
  enabled: boolean;
  patterns: ChannelPattern[];
  keepInMain: boolean;       // false (default) = lines move to the tab; true = copy, main keeps them
  notify: ChannelNotify;
  /**
   * Games often pad a channel line with a blank line before and after. When a line moves to this
   * tab, also drop the blank line that follows it and the one just before it, so the main pane
   * is not left with empty gaps. Default true.
   */
  trimBlanks: boolean;
  timestamps: boolean;        // show HH:MM before each captured line
  /**
   * Command-triggered capture: a regex tested against each command you send (after prefix and
   * aliases). When it matches, the command's echo and everything the game sends afterwards go
   * to this tab, until the output has been quiet for `captureQuietMs` or you send another
   * command. '' = off. Lines that a pattern tab claims still go to that tab.
   */
  captureCommands: string;
  captureQuietMs: number;
  /**
   * Put in front of whatever is typed while this tab is showing (e.g. "ooc " so typing "hi"
   * sends "ooc hi"). '' (default) = type to the game as usual. A command starting with "\"
   * is sent without it, once. Applied before aliases, stacking and speedwalk.
   */
  commandPrefix: string;
  /** Extra vertical space (px) between lines in this tab's pane, to make chat easier to read. 0 = none. */
  messageGap: number;
  /** Tint for the sub-tab and its unread pill: an ANSI palette index ('0'..'15'), a CSS colour, or '' for Lantern's accent. */
  colour: string;
}

export type ChannelNotify = 'badge' | 'badge+sound' | 'silent';

export interface ChannelPattern {
  id: string;
  pattern: string;           // JS regex source
  ignoreCase: boolean;
  mode: ChannelMode;
  // capture  = line goes to the tab (and is removed from main unless keepInMain)
  // silence  = line is dropped from main AND not shown in the tab (noise like a bare "[AFK]" line)
}

export type ChannelMode = 'capture' | 'silence';

export type LogFormat = 'text' | 'html' | 'raw';
export interface LogSettings {
  output: boolean;          // game text
  commands: boolean;        // what you typed
  notes: boolean;           // client notes (connect/disconnect, trigger notes, Lua Note)
  format: LogFormat;        // plain text, or HTML with colours
  file: string;             // name pattern; see shared/logname.ts
  worldNameHeader: boolean; // write a "world name, date" line at the start of each session
}

export const DEFAULT_LOG: LogSettings = { output: true, commands: true, notes: false, format: 'text', file: '', worldNameHeader: true };

export function normalizeLog(l: Partial<LogSettings> | undefined): LogSettings {
  const format: LogFormat = l?.format === 'html' ? 'html' : l?.format === 'raw' ? 'raw' : 'text';
  return { ...DEFAULT_LOG, ...(l ?? {}), format };
}

export interface World {
  id: string;
  name: string;
  host: string;
  port: number;
  encoding: string;         // 'utf-8' | 'latin1'
  notes?: string;
  logging: boolean;         // master switch; details in `log`
  log: LogSettings;
  /** Text sent automatically after connecting (e.g. "connect name password"). Plain text for now. */
  autoConnect?: string;
  createdAt: string;

  triggers: Trigger[];
  aliases: Alias[];
  timers: Timer[];
  channelTabs: ChannelTab[];

  /** Script variables (Lua GetVariable/SetVariable), persisted with the world. */
  variables: Record<string, string>;

  /** Command stacking: "look;inv" sends two commands. Off by default. */
  commandStacking: boolean;
  commandStackChar: string;
  /** Speedwalk: "#3n2e" sends n n n e e. Off by default. */
  speedwalk: boolean;
  speedwalkPrefix: string;
  /** *italic*, **bold** and __underline__ in typed chat commands become the game's format codes. Off by default. */
  markup: MarkupSettings;
  /**
   * Accept the game's offer of MXP (telnet option 91) and render the <B>, <I>, <U>, <COLOR>, <SEND>
   * and <A> tags it then sends (shared/mxp.ts); the same switch answers a Pueblo announcement
   * (shared/pueblo.ts). On by default: games that offer neither are unaffected.
   */
  mxp: boolean;
  /** Set once we've pre-loaded sensible defaults (e.g. Haven channel tabs), so we don't re-add them. */
  seededDefaults?: boolean;
}

/**
 * Markdown-style emphasis in typed commands (src/lib/automation.ts applyMarkup): only commands
 * that start with one of `commands` are touched, so `*` in "give 2*3 coins" or a wildcard in an
 * alias test stays as typed. The codes default to Haven's backtick format codes.
 */
export interface MarkupSettings {
  enabled: boolean;
  /** Space-separated. A word matches the command's first word; a symbol (":" or "\"") matches the start. */
  commands: string;
  boldOn: string; boldOff: string;
  italicOn: string; italicOff: string;
  underlineOn: string; underlineOff: string;
}

export const DEFAULT_MARKUP: MarkupSettings = {
  enabled: false,
  // Haven's chat verbs (the old Haven_Italics plugin covered say, emote, private, announce and subtle) plus common MUSH ones.
  commands: 'say emote private announce subtle pose ooc chat tell page whisper think : "',
  boldOn: '`1', boldOff: '`4',
  italicOn: '`2', italicOff: '`5',
  underlineOn: '`3', underlineOff: '`6',
};

export function normalizeMarkup(m: Partial<MarkupSettings> | undefined | null): MarkupSettings {
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  return {
    enabled: m?.enabled === true,
    commands: str(m?.commands, DEFAULT_MARKUP.commands),
    boldOn: str(m?.boldOn, DEFAULT_MARKUP.boldOn), boldOff: str(m?.boldOff, DEFAULT_MARKUP.boldOff),
    italicOn: str(m?.italicOn, DEFAULT_MARKUP.italicOn), italicOff: str(m?.italicOff, DEFAULT_MARKUP.italicOff),
    underlineOn: str(m?.underlineOn, DEFAULT_MARKUP.underlineOn), underlineOff: str(m?.underlineOff, DEFAULT_MARKUP.underlineOff),
  };
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
    channelTabs: (w.channelTabs ?? []).map(normalizeChannelTab),
    log: normalizeLog(w.log),
    variables: { ...(w.variables ?? {}) },
    commandStacking: w.commandStacking ?? false,
    commandStackChar: w.commandStackChar || DEFAULT_STACK_CHAR,
    speedwalk: w.speedwalk ?? false,
    speedwalkPrefix: w.speedwalkPrefix || DEFAULT_SPEEDWALK_PREFIX,
    markup: normalizeMarkup(w.markup),
    // `pueblo` was this switch's name for one unreleased commit.
    mxp: w.mxp !== false && (w as { pueblo?: boolean }).pueblo !== false,
  };
}

export function normalizeTrigger(t: Partial<Trigger> & Pick<Trigger, 'id'>): Trigger {
  return {
    name: '', pattern: '', regex: false, enabled: true, group: '', ignoreCase: false,
    send: '', sendTo: 'world', highlight: null, highlightBg: null, highlightLine: false, gag: false, oneShot: false,
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

export function normalizeChannelTab(c: Partial<ChannelTab> & Pick<ChannelTab, 'id'>): ChannelTab {
  const notify: ChannelNotify = c.notify === 'badge+sound' || c.notify === 'silent' ? c.notify : 'badge';
  return {
    name: 'Channel', enabled: true, keepInMain: false, trimBlanks: true,
    timestamps: typeof c.timestamps === 'boolean' ? c.timestamps : true,
    ...c,
    notify,
    commandPrefix: typeof c.commandPrefix === 'string' ? c.commandPrefix : '',
    captureCommands: typeof c.captureCommands === 'string' ? c.captureCommands : '',
    captureQuietMs: typeof c.captureQuietMs === 'number' && c.captureQuietMs >= 200 ? c.captureQuietMs : 1500,
    messageGap: typeof c.messageGap === 'number' && c.messageGap >= 0 ? Math.min(c.messageGap, 40) : 0,
    colour: typeof c.colour === 'string' ? c.colour : '',
    patterns: (c.patterns ?? []).map(normalizeChannelPattern),
  };
}

export function normalizeChannelPattern(p: Partial<ChannelPattern> & Pick<ChannelPattern, 'id'>): ChannelPattern {
  return {
    pattern: '', ignoreCase: false,
    ...p,
    mode: p.mode === 'silence' ? 'silence' : 'capture',
  };
}
