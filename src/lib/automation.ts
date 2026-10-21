/**
 * Automation engine: trigger matching over finished output lines, alias and
 * speedwalk expansion of typed commands, and a timer scheduler. Pure
 * TypeScript with no DOM or Electron dependencies so it can be unit-tested
 * under Node (scripts/test-automation.mjs).
 */
import type { Trigger, Alias, Timer, World, SendTo, MarkupSettings } from '../../shared/types';
import type { Span } from './ansi';

export interface Outgoing { text: string; sendTo: SendTo }

/* ---------- patterns ---------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Plain-text pattern → regex source. "*" is a wildcard that captures; a pattern with any "*" must span the whole line. */
function globToSource(pattern: string): string {
  if (!pattern.includes('*')) return escapeRe(pattern);
  return '^' + pattern.split('*').map(escapeRe).join('(.*)') + '$';
}

const cache = new Map<string, RegExp | null>();

/** Compile a trigger or alias pattern; null when the regex is invalid. Cached by its text and flags. */
export function compile(pattern: string, regex: boolean, ignoreCase: boolean, kind: 'trigger' | 'alias'): RegExp | null {
  const key = `${kind}|${regex ? 'r' : 'p'}|${ignoreCase ? 'i' : 'c'}|${pattern}`;
  if (cache.has(key)) return cache.get(key)!;
  let re: RegExp | null = null;
  try {
    let src: string;
    if (regex) src = pattern;
    else if (kind === 'trigger' || pattern.includes('*')) src = globToSource(pattern);
    else src = '^' + escapeRe(pattern) + '(?:\\s+(.*))?$';   // plain alias = command prefix, %1 = the rest
    re = new RegExp(src, 'g' + (ignoreCase ? 'i' : ''));
  } catch { re = null; }
  if (cache.size > 2000) cache.clear();
  cache.set(key, re);
  return re;
}

/** A human-readable problem with a pattern, or null when it compiles. */
export function patternError(pattern: string, regex: boolean): string | null {
  if (!pattern) return 'Pattern is empty';
  if (!regex) return null;
  try { new RegExp(pattern); return null; } catch (e) { return (e as Error).message.replace(/^Invalid regular expression: /, ''); }
}

/** Replace %0..%9 with captures and %% with a literal percent. */
export function substitute(template: string, m: ArrayLike<string>): string {
  return template.replace(/%(%|\d)/g, (_, d: string) => (d === '%' ? '%' : (m[Number(d)] ?? '')));
}

/** One command per line; blank lines dropped. */
export function splitSend(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
}

/* ---------- typed-command cleaning ---------- */

/**
 * Punctuation that phones, Word and web pages turn ordinary typing into, mapped to what a
 * MUD expects. Letters with accents, symbols and emoji are left alone: those are a choice,
 * and games on UTF-8 show them fine. See cleanTyped.
 */
const TYPED_SWAPS: Record<string, string> = {
  // single quotes and apostrophes
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'", '\u2032': "'", '\u2035': "'",
  '\u02BC': "'", '\u00B4': "'", '\u2039': "'", '\u203A': "'",
  // double quotes
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"', '\u2033': '"', '\u2036': '"',
  '\u00AB': '"', '\u00BB': '"',
  // dashes: the short ones become a hyphen, the long ones the "--" roleplayers type
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2212': '-',
  '\u2014': '--', '\u2015': '--',
  // the rest
  '\u2026': '...', '\u2044': '/', '\u2022': '*',
};
const SWAP_RE = new RegExp(`[${Object.keys(TYPED_SWAPS).join('')}]`, 'g');
const LINE_BREAKS = /\r\n?|[\u2028\u2029\u0085]/g;                        // Windows and Unicode line breaks → \n
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD\u034F\u180E]/g;       // zero-width spaces/joiners, BOM, soft hyphen
const ODD_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;      // non-breaking, en, em, thin, ideographic…
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g; // everything but \t and \n
const FULLWIDTH = /[\uFF01-\uFF5E]/g;                                     // ！Ａ１ from a CJK keyboard → !A1

/**
 * Tidy a typed command for the game: curly quotes to straight, dashes to hyphens, an ellipsis
 * to three dots, odd spaces to a plain space, invisible characters and stray control codes
 * removed, Windows line breaks to \n, full-width ASCII to ASCII, and accented letters composed
 * (NFC) so a latin1 world can encode them. Plain ASCII comes back unchanged.
 */
export function cleanTyped(text: string): string {
  if (!/[^\x20-\x7E\n\t]/.test(text)) return text;   // nothing to do for plain ASCII
  return text
    .normalize('NFC')
    .replace(LINE_BREAKS, '\n')
    .replace(INVISIBLE, '')
    .replace(ODD_SPACES, ' ')
    .replace(CONTROLS, '')
    .replace(FULLWIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(SWAP_RE, (ch) => TYPED_SWAPS[ch]);
}

/* ---------- markup: *italic*, **bold**, __underline__ in chat commands ---------- */

const escapeForRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the command starts with one of the listed verbs (first word, any case) or symbols. */
export function markupApplies(commands: string, text: string): boolean {
  for (const c of commands.split(/\s+/).filter(Boolean)) {
    if (/^\w+$/.test(c)) { if (new RegExp(`^${escapeForRe(c)}(?:\\s|$)`, 'i').test(text)) return true; }
    else if (text.startsWith(c)) return true;
  }
  return false;
}

// Bold first so "**x**" is not read as two italics; the emphasis must hug its text (no space just
// inside), a lone "*" or "**" stays, and a "*" glued to a word on the outside ("2*3*4") stays too.
const BOLD_RE = /(?<!\\)\*\*(\S(?:[^*]*?\S)?)\*\*/g;
const ITALIC_RE = /(?<![\\\w*])\*(\S(?:[^*]*?\S)?)\*(?![\w*])/g;
const UNDERLINE_RE = /(?<![\\\w])__(\S(?:[^_]*?\S)?)__(?!\w)/g;

/**
 * Turn Markdown-style emphasis in a typed chat command into the world's format codes:
 * "say *hi* **there** __now__" → "say `2hi`5 `1there`4 `3now`6" with the Haven defaults.
 * Only when enabled and the command starts with a listed verb or symbol; "\*" and "\_" send a
 * literal character. Everything else comes back exactly as typed.
 */
export function applyMarkup(m: MarkupSettings, text: string): string {
  if (!m.enabled || !/[*_]/.test(text) || !markupApplies(m.commands, text)) return text;
  return text
    .replace(BOLD_RE, (_, s: string) => m.boldOn + s + m.boldOff)
    .replace(ITALIC_RE, (_, s: string) => m.italicOn + s + m.italicOff)
    .replace(UNDERLINE_RE, (_, s: string) => m.underlineOn + s + m.underlineOff)
    .replace(/\\([*_])/g, '$1');
}

/* ---------- triggers ---------- */

export interface Highlight { start: number; end: number; colour: string | null; bg?: string | null }

/** What a trigger or alias matched: `wildcards[0]` is the whole match, 1..n the captures, plus any named groups. */
export interface Match { wildcards: string[]; named: Record<string, string> }

export interface TriggerResult {
  gag: boolean;
  outgoing: Outgoing[];
  highlights: Highlight[];
  fired: Trigger[];
  matches: { trigger: Trigger; match: Match }[];
}

export function toMatch(m: RegExpExecArray): Match {
  const wildcards: string[] = [];
  for (let i = 0; i < m.length; i++) wildcards.push(m[i] ?? '');
  const named: Record<string, string> = {};
  if (m.groups) for (const [k, v] of Object.entries(m.groups)) named[k] = v ?? '';
  return { wildcards, named };
}

/** Run every enabled trigger against one line of plain text. Nothing is mutated. */
export function runTriggers(triggers: readonly Trigger[], line: string): TriggerResult {
  const res: TriggerResult = { gag: false, outgoing: [], highlights: [], fired: [], matches: [] };
  for (const t of triggers) {
    if (!t.enabled || !t.pattern) continue;
    const re = compile(t.pattern, t.regex, t.ignoreCase, 'trigger');
    if (!re) continue;
    re.lastIndex = 0;
    const first = re.exec(line);
    if (!first) continue;
    res.fired.push(t);
    res.matches.push({ trigger: t, match: toMatch(first) });
    if (t.gag) res.gag = true;
    if (t.send) for (const cmd of splitSend(substitute(t.send, first))) res.outgoing.push({ text: cmd, sendTo: t.sendTo });
    if (t.highlight || t.highlightBg) {
      if (t.highlightLine || first[0].length === 0) {
        res.highlights.push({ start: 0, end: line.length, colour: t.highlight, ...(t.highlightBg ? { bg: t.highlightBg } : {}) });
      } else {
        // Colour every occurrence on the line (MUSHclient's "repeat on same line").
        let m: RegExpExecArray | null = first;
        while (m) {
          if (m[0].length) res.highlights.push({ start: m.index, end: m.index + m[0].length, colour: t.highlight, ...(t.highlightBg ? { bg: t.highlightBg } : {}) });
          if (m.index + m[0].length >= line.length) break;
          if (m[0].length === 0) re.lastIndex++;
          m = re.exec(line);
        }
      }
    }
  }
  return res;
}

/** Return new spans with the given character ranges recoloured. Earlier highlights win where ranges overlap. */
export function applyHighlights(spans: readonly Span[], highlights: readonly Highlight[]): Span[] {
  if (!highlights.length) return spans.slice();
  // Collect every boundary, then rebuild spans segment by segment.
  const cuts = new Set<number>([0]);
  let total = 0;
  for (const sp of spans) { total += sp.text.length; cuts.add(total); }
  for (const h of highlights) { cuts.add(Math.max(0, Math.min(total, h.start))); cuts.add(Math.max(0, Math.min(total, h.end))); }
  const points = [...cuts].sort((a, b) => a - b);

  const out: Span[] = [];
  let si = 0, spanStart = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (b <= a) continue;
    while (si < spans.length && spanStart + spans[si].text.length <= a) { spanStart += spans[si].text.length; si++; }
    const src = spans[si];
    if (!src) break;
    const text = src.text.slice(a - spanStart, b - spanStart);
    const hl = highlights.find((h) => h.start <= a && b <= h.end);
    const style = hl ? { ...src.style, fg: hl.colour ?? src.style.fg, bg: hl.bg != null ? hl.bg : src.style.bg, bold: false, dim: false } : src.style;
    const last = out[out.length - 1];
    if (last && last.style === style) last.text += text;
    else out.push({ text, style });
  }
  return out;
}

/* ---------- aliases, stacking, speedwalk ---------- */

export interface ExpandResult {
  outgoing: Outgoing[];
  aliasesUsed: Alias[];
  matches: { alias: Alias; command: string; match: Match }[];
}

/** Try the enabled aliases against one command; the first that matches wins. Null when none match. */
export function expandAlias(aliases: readonly Alias[], command: string): { alias: Alias; outgoing: Outgoing[]; match: Match } | null {
  for (const a of aliases) {
    if (!a.enabled || !a.pattern) continue;
    const re = compile(a.pattern, a.regex, a.ignoreCase, 'alias');
    if (!re) continue;
    re.lastIndex = 0;
    const m = re.exec(command);
    if (!m) continue;
    const outgoing = splitSend(substitute(a.send, m)).map((text) => ({ text, sendTo: a.sendTo }));
    return { alias: a, outgoing, match: toMatch(m) };
  }
  return null;
}

const DIRS: Record<string, string> = {
  n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};

/**
 * "3n2eu" → ["n","n","n","e","e","u"]. Letters are sent as typed (short form).
 * Anything inside parentheses is sent verbatim: "2n(open door)n". Null when the text isn't a speedwalk.
 */
export function expandSpeedwalk(body: string): string[] | null {
  const out: string[] = [];
  const re = /\s*(?:(\d*)\s*(ne|nw|se|sw|[nsewud])|\(([^)]*)\))\s*/giy;
  let i = 0;
  while (i < body.length) {
    re.lastIndex = i;
    const m = re.exec(body);
    if (!m || m.index !== i || m[0].length === 0) return null;
    if (m[3] !== undefined) out.push(m[3].trim());
    else {
      const n = m[1] ? Number(m[1]) : 1;
      const dir = m[2].toLowerCase();
      if (!DIRS[dir] || n > 99) return null;
      for (let k = 0; k < n; k++) out.push(dir);
    }
    i = re.lastIndex;
  }
  return out.length ? out : null;
}

/** Split on the stacking character; a doubled character is a literal. */
export function splitStacked(text: string, ch: string): string[] {
  if (!ch) return [text];
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ch) {
      if (text[i + 1] === ch) { cur += ch; i++; continue; }
      out.push(cur); cur = '';
    } else cur += text[i];
  }
  out.push(cur);
  return out;
}

/** Everything that happens to a typed command before it reaches the game. */
export function expandCommand(world: Pick<World, 'aliases' | 'commandStacking' | 'commandStackChar' | 'speedwalk' | 'speedwalkPrefix'>, text: string): ExpandResult {
  const pieces = world.commandStacking ? splitStacked(text, world.commandStackChar) : [text];
  const res: ExpandResult = { outgoing: [], aliasesUsed: [], matches: [] };
  for (const piece of pieces) {
    if (world.speedwalk && world.speedwalkPrefix && piece.startsWith(world.speedwalkPrefix)) {
      const walk = expandSpeedwalk(piece.slice(world.speedwalkPrefix.length));
      if (walk) { for (const step of walk) res.outgoing.push({ text: step, sendTo: 'world' }); continue; }
    }
    const al = expandAlias(world.aliases, piece);
    if (al) {
      res.aliasesUsed.push(al.alias);
      res.matches.push({ alias: al.alias, command: piece, match: al.match });
      res.outgoing.push(...al.outgoing);
      continue;
    }
    res.outgoing.push({ text: piece, sendTo: 'world' });
  }
  return res;
}

/* ---------- timers ---------- */

/** Milliseconds until the next occurrence of 'HH:MM[:SS]' local time; null for a bad value. */
export function msUntil(at: string, now: Date = new Date()): number | null {
  const m = at.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]), s = Number(m[3] ?? 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  const next = new Date(now);
  next.setHours(h, mi, s, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

type Handle = { kind: 'interval' | 'timeout'; id: ReturnType<typeof setTimeout> };

/** Runs a world's timers while a session is connected. One scheduler per session. */
export class TimerScheduler {
  private handles = new Map<string, Handle>();   // timer id → handle
  constructor(private fire: (timer: Timer) => void) {}

  start(timers: readonly Timer[]) {
    this.stop();
    for (const t of timers) this.schedule(t);
  }

  private schedule(t: Timer) {
    if (!t.enabled) return;
    if (t.at) {
      const ms = msUntil(t.at);
      if (ms === null) return;
      const id = setTimeout(() => {
        this.handles.delete(t.id);
        this.fire(t);
        if (!t.oneShot) this.schedule(t);
      }, ms);
      this.handles.set(t.id, { kind: 'timeout', id });
    } else if (t.everySeconds > 0) {
      const ms = Math.max(1000, t.everySeconds * 1000);
      if (t.oneShot) {
        const id = setTimeout(() => { this.handles.delete(t.id); this.fire(t); }, ms);
        this.handles.set(t.id, { kind: 'timeout', id });
      } else {
        const id = setInterval(() => this.fire(t), ms);
        this.handles.set(t.id, { kind: 'interval', id });
      }
    }
  }

  stop() {
    for (const h of this.handles.values()) (h.kind === 'interval' ? clearInterval : clearTimeout)(h.id);
    this.handles.clear();
  }

  get running() { return this.handles.size; }
}

/** What a timer's schedule looks like in words, for lists and tooltips. */
export function describeTimer(t: Timer): string {
  if (t.at) return `daily at ${t.at}`;
  const s = t.everySeconds;
  if (s % 3600 === 0) return `every ${s / 3600}h`;
  if (s % 60 === 0) return `every ${s / 60}m`;
  return `every ${s}s`;
}
