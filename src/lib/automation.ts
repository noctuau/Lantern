/**
 * Automation engine: trigger matching over finished output lines, alias and
 * speedwalk expansion of typed commands, and a timer scheduler. Pure
 * TypeScript with no DOM or Electron dependencies so it can be unit-tested
 * under Node (scripts/test-automation.mjs).
 */
import type { Trigger, Alias, Timer, World, SendTo } from '../../shared/types';
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

/* ---------- triggers ---------- */

export interface Highlight { start: number; end: number; colour: string }

export interface TriggerResult {
  gag: boolean;
  outgoing: Outgoing[];
  highlights: Highlight[];
  fired: Trigger[];
}

/** Run every enabled trigger against one line of plain text. Nothing is mutated. */
export function runTriggers(triggers: readonly Trigger[], line: string): TriggerResult {
  const res: TriggerResult = { gag: false, outgoing: [], highlights: [], fired: [] };
  for (const t of triggers) {
    if (!t.enabled || !t.pattern) continue;
    const re = compile(t.pattern, t.regex, t.ignoreCase, 'trigger');
    if (!re) continue;
    re.lastIndex = 0;
    const first = re.exec(line);
    if (!first) continue;
    res.fired.push(t);
    if (t.gag) res.gag = true;
    if (t.send) for (const cmd of splitSend(substitute(t.send, first))) res.outgoing.push({ text: cmd, sendTo: t.sendTo });
    if (t.highlight) {
      if (t.highlightLine || first[0].length === 0) {
        res.highlights.push({ start: 0, end: line.length, colour: t.highlight });
      } else {
        // Colour every occurrence on the line (MUSHclient's "repeat on same line").
        let m: RegExpExecArray | null = first;
        while (m) {
          if (m[0].length) res.highlights.push({ start: m.index, end: m.index + m[0].length, colour: t.highlight });
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
    const style = hl ? { ...src.style, fg: hl.colour, bold: false, dim: false } : src.style;
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
}

/** Try the enabled aliases against one command; the first that matches wins. Null when none match. */
export function expandAlias(aliases: readonly Alias[], command: string): { alias: Alias; outgoing: Outgoing[] } | null {
  for (const a of aliases) {
    if (!a.enabled || !a.pattern) continue;
    const re = compile(a.pattern, a.regex, a.ignoreCase, 'alias');
    if (!re) continue;
    re.lastIndex = 0;
    const m = re.exec(command);
    if (!m) continue;
    const outgoing = splitSend(substitute(a.send, m)).map((text) => ({ text, sendTo: a.sendTo }));
    return { alias: a, outgoing };
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
  const res: ExpandResult = { outgoing: [], aliasesUsed: [] };
  for (const piece of pieces) {
    if (world.speedwalk && world.speedwalkPrefix && piece.startsWith(world.speedwalkPrefix)) {
      const walk = expandSpeedwalk(piece.slice(world.speedwalkPrefix.length));
      if (walk) { for (const step of walk) res.outgoing.push({ text: step, sendTo: 'world' }); continue; }
    }
    const al = expandAlias(world.aliases, piece);
    if (al) { res.aliasesUsed.push(al.alias); res.outgoing.push(...al.outgoing); continue; }
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
