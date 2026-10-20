/**
 * Channel tabs: routing finished output lines into capture panes. Pure
 * TypeScript (no DOM or Electron) so scripts/test-channels.mjs can run it
 * under Node. The store calls `classifyLine` for every line from the game;
 * the Channels editor calls `routeLine` for its Try-it box.
 *
 * Order of events for a line (docs/channel-tabs.md):
 *   1. triggers run (highlight, gag, send) — a gagged line never reaches a tab;
 *   2. channel patterns: the first matching pattern, tabs in order then patterns
 *      in order, wins; `silence` drops the line, `capture` routes it;
 *   3. the log gets every line, captured ones prefixed with "[tab name] ".
 */
import type { ChannelTab, ChannelPattern, Trigger } from '../../shared/types';
import { runTriggers, type TriggerResult } from './automation';

/** Where a line ends up. `tab` is null when it simply stays in the main pane. */
export interface Route {
  action: 'main' | 'capture' | 'silence';
  tab: ChannelTab | null;
  pattern: ChannelPattern | null;
  /** The main pane shows the line (not captured, or captured by a keep-in-main tab). */
  showInMain: boolean;
  /** The tab shows the line (captured, not silenced). */
  showInTab: boolean;
}

const MAIN: Route = { action: 'main', tab: null, pattern: null, showInMain: true, showInTab: false };

const cache = new Map<string, RegExp | null>();

/** Compile a channel pattern; null when the regex is invalid. Cached by text and flags. */
export function compileChannel(p: Pick<ChannelPattern, 'pattern' | 'ignoreCase'>): RegExp | null {
  const key = `${p.ignoreCase ? 'i' : 'c'}|${p.pattern}`;
  if (cache.has(key)) return cache.get(key)!;
  let re: RegExp | null = null;
  try { re = new RegExp(p.pattern, p.ignoreCase ? 'i' : ''); } catch { re = null; }
  if (cache.size > 1000) cache.clear();
  cache.set(key, re);
  return re;
}

/** A human-readable problem with a channel pattern, or null when it compiles. */
export function channelPatternError(pattern: string): string | null {
  if (!pattern) return 'Pattern is empty';
  try { new RegExp(pattern); return null; } catch (e) { return (e as Error).message.replace(/^Invalid regular expression: /, ''); }
}

/** Test one line of plain text against every enabled tab. The first matching pattern wins. */
export function routeLine(tabs: readonly ChannelTab[], line: string): Route {
  for (const tab of tabs) {
    if (!tab.enabled) continue;
    for (const p of tab.patterns) {
      if (!p.pattern) continue;
      const re = compileChannel(p);
      if (!re || !re.test(line)) continue;
      if (p.mode === 'silence') return { action: 'silence', tab, pattern: p, showInMain: false, showInTab: false };
      return { action: 'capture', tab, pattern: p, showInMain: tab.keepInMain, showInTab: true };
    }
  }
  return MAIN;
}

export interface Classified {
  triggers: TriggerResult;
  /** Null when a trigger gagged the line: it is shown nowhere and never reaches a tab. */
  route: Route | null;
}

/** Everything that decides where a finished line from the game goes: triggers first, then channel patterns. */
export function classifyLine(triggers: readonly Trigger[], tabs: readonly ChannelTab[], line: string): Classified {
  const tr = runTriggers(triggers, line);
  if (tr.gag) return { triggers: tr, route: null };
  return { triggers: tr, route: tabs.length ? routeLine(tabs, line) : MAIN };
}

/** The text a captured line gets in the daily log, so the log still reads as a whole. */
/** The first enabled tab whose command pattern matches a command you sent, or null. */
export function commandCaptureTab(tabs: readonly ChannelTab[], command: string): ChannelTab | null {
  for (const tab of tabs) {
    if (!tab.enabled || !tab.captureCommands) continue;
    try { if (new RegExp(tab.captureCommands, 'i').test(command)) return tab; } catch { /* bad regex: ignore */ }
  }
  return null;
}

export const HELP_TAB_NAME = 'Help';
export const HELP_COMMANDS = '^(help|rules|policy|news|motd)\\b';

/** A tab that collects the replies to help commands. */
export function helpChannelTab(uid: () => string): ChannelTab {
  return {
    id: uid(), name: HELP_TAB_NAME, enabled: true, keepInMain: false, trimBlanks: false, notify: 'badge',
    commandPrefix: '', captureCommands: HELP_COMMANDS, captureQuietMs: 1500, messageGap: 0, patterns: [],
  };
}

export function hasHelpPreset(tabs: readonly ChannelTab[]): boolean {
  return tabs.some((t) => t.captureCommands === HELP_COMMANDS);
}

export function logPrefix(route: Route | null): string {
  return route && route.action === 'capture' && route.tab ? `[${route.tab.name}] ` : '';
}

/* ---------- command prefix ---------- */

/** Start a typed command with this to send it without the active tab's prefix, once. */
export const PREFIX_BYPASS = '\\';

/**
 * The command prefix the input bar applies for a session's view: the active tab's
 * `commandPrefix`, or '' on Main, on a disabled or missing tab, or when the tab has none.
 */
export function activePrefix(tabs: readonly ChannelTab[], view: string): string {
  const tab = tabs.find((t) => t.id === view && t.enabled);
  return tab?.commandPrefix ?? '';
}

export interface Prefixed {
  /** What goes on to aliases, stacking and the game. */
  text: string;
  /** The prefix was put in front of the typed text. */
  applied: boolean;
  /** The typed text began with PREFIX_BYPASS, which was removed and the prefix skipped. */
  bypassed: boolean;
}

/**
 * Apply a view's command prefix to what was typed. With no prefix the text passes through
 * untouched (a leading backslash included, so Main behaves exactly as before). With a prefix,
 * a leading backslash is removed and the prefix skipped for that one command; a blank line
 * is sent blank, since "ooc " on its own would only earn an error from the game.
 */
export function applyCommandPrefix(prefix: string, typed: string): Prefixed {
  if (!prefix) return { text: typed, applied: false, bypassed: false };
  if (typed.startsWith(PREFIX_BYPASS)) return { text: typed.slice(PREFIX_BYPASS.length), applied: false, bypassed: true };
  if (!typed.trim()) return { text: typed, applied: false, bypassed: false };
  return { text: prefix + typed, applied: true, bypassed: false };
}

/* ---------- presets ---------- */

/**
 * Haven's public channels, from Noctua's old OOC-world trigger. While AFK, Haven prints a bare
 * "[AFK]" line before each channel message; that line is silenced. When "[AFK]" shares the line
 * with the message, the channel pattern still matches, so nothing extra is needed.
 */
export const HAVEN_CHANNEL_PATTERNS: Omit<ChannelPattern, 'id'>[] = [
  { pattern: '^\\[OOC\\] ', ignoreCase: false, mode: 'capture' },
  { pattern: '^\\[Guide\\] ', ignoreCase: false, mode: 'capture' },
  { pattern: '^\\[Newbie\\] ', ignoreCase: false, mode: 'capture' },
  { pattern: '^\\[HeyThere\\] ', ignoreCase: false, mode: 'capture' },
  { pattern: '^\\[AFK\\]\\s*$', ignoreCase: false, mode: 'silence' },
];

export const HAVEN_TAB_NAME = 'OOC channels';

/** Build the one-click preset tab. `uid` supplies ids so the renderer can use crypto.randomUUID. */
export function havenChannelTab(uid: () => string): ChannelTab {
  return {
    id: uid(),
    name: HAVEN_TAB_NAME,
    enabled: true,
    keepInMain: false,
    trimBlanks: true,
    notify: 'badge',
    captureCommands: '',
    captureQuietMs: 1500,
    messageGap: 6,
    // No prefix: the old setup redirected whole commands to another world rather than
    // prepending a channel command, so there is no "ooc " to copy. Set one in the editor.
    commandPrefix: '',
    patterns: HAVEN_CHANNEL_PATTERNS.map((p) => ({ id: uid(), ...p })),
  };
}

/** True when the world already has a tab carrying every Haven starter pattern. */
export function hasHavenPreset(tabs: readonly ChannelTab[]): boolean {
  return tabs.some((t) => HAVEN_CHANNEL_PATTERNS.every((hp) => t.patterns.some((p) => p.pattern === hp.pattern && p.mode === hp.mode)));
}
