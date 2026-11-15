/**
 * Find-in-output matching. A pure pass over the committed lines so the UI (the find bar in
 * OutputPane) can highlight every hit and step between them. Plain text is matched as a literal
 * substring; with the regex toggle on, the phrase is a JavaScript regular expression. Either way the
 * match is case-insensitive unless "match case" is on.
 *
 * Matching runs over a line's full text (its spans joined), so a hit that straddles a colour change
 * is still found; OutputPane maps the returned character ranges back onto the styled spans.
 */

export interface FindOptions {
  regex: boolean;
  caseSensitive: boolean;
}

/** One hit: a [start, end) range of characters within line `lineId` (at buffer index `lineIndex`). */
export interface FindMatch {
  lineId: number;
  lineIndex: number;
  start: number;
  end: number;
}

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** Escape a plain phrase so it matches literally when fed to RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(SPECIAL, '\\$&');
}

/**
 * The global RegExp for a query, or null for an empty query. Throws when the regex toggle is on and
 * the pattern is invalid — callers that want a yes/no use queryIsValid instead.
 */
export function compileQuery(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null;
  const src = opts.regex ? query : escapeRegExp(query);
  return new RegExp(src, opts.caseSensitive ? 'g' : 'gi');
}

/** Whether the query can be used — always true for plain text or an empty box; a regex must compile. */
export function queryIsValid(query: string, opts: FindOptions): boolean {
  if (!query || !opts.regex) return true;
  try { new RegExp(query); return true; } catch { return false; }
}

/**
 * Every match across the lines, in reading order (top line first, left-to-right within a line).
 * A line with no text is skipped. Zero-width matches (e.g. `x*` against "y") are not recorded and
 * never stall the scan. An invalid regex yields no matches rather than throwing.
 */
export function findMatches(
  lines: readonly { id: number; text: string }[],
  query: string,
  opts: FindOptions,
): FindMatch[] {
  let re: RegExp | null;
  try { re = compileQuery(query, opts); } catch { return []; }
  if (!re) return [];

  const out: FindMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    if (!text) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (end > start) out.push({ lineId: lines[i].id, lineIndex: i, start, end });
      // A zero-width match leaves lastIndex where it is; nudge it on so exec can't loop forever.
      if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
    }
  }
  return out;
}
