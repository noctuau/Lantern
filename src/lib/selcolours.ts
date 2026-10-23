/**
 * Rebuild the game's backtick colour codes from a selection of coloured output, so you can copy the
 * codes behind text the game coloured (e.g. a gradient someone posted). Each colour run becomes
 * `#rrggbb (truecolour, the form Haven's codes use), the default colour becomes `w, and the whole
 * thing ends with `w so a paste doesn't bleed. Colours are read as displayed, so an xterm or palette
 * colour comes out as its resolved hex.
 */

export interface ColourSeg { text: string; hex: string | null } // hex null = the pane's default colour

/** Build a backtick-code string from coloured segments. Pure, so it can be unit-tested. */
export function buildColourCodes(segs: ColourSeg[]): string {
  let out = '', last = '';
  for (const s of segs) {
    if (!s.text) continue;
    const code = s.hex ? '`' + s.hex : '`w';
    if (code !== last) { out += code; last = code; }
    out += s.text;
  }
  if (!out) return '';
  if (last !== '`w') out += '`w';
  return out;
}

/** "rgb(100, 255, 51)" → "#64ff33"; null if it can't be parsed. */
export function rgbToHex(c: string | null | undefined): string | null {
  if (!c) return null;
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  const h = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
  return '#' + h(m[1]) + h(m[2]) + h(m[3]);
}

/**
 * The current selection, if it is inside an output pane and has at least one colour, as backtick
 * codes; otherwise null. Reads the displayed colour of each selected span (CSS vars resolved).
 */
export function selectionColourCodes(): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const anchorEl = (anchor.nodeType === 1 ? anchor : anchor.parentElement) as Element | null;
  const root = anchorEl?.closest('.output');
  if (!root) return null;
  const defaultHex = rgbToHex(getComputedStyle(root).color);

  const segs: ColourSeg[] = [];
  let curLine: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const full = n.textContent ?? '';
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : full.length;
    const text = full.slice(start, end);
    if (!text) continue;
    const lineEl = n.parentElement?.closest('.line') ?? null;
    if (segs.length && lineEl !== curLine) segs[segs.length - 1].text += '\n'; // keep line breaks
    curLine = lineEl;
    let hex = n.parentElement ? rgbToHex(getComputedStyle(n.parentElement).color) : null;
    if (hex && defaultHex && hex.toLowerCase() === defaultHex.toLowerCase()) hex = null;
    segs.push({ text, hex });
  }
  const codes = buildColourCodes(segs);
  return codes && codes.includes('`#') ? codes : null;
}
