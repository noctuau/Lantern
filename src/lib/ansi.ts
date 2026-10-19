/**
 * Streaming ANSI/SGR parser. Feed it text chunks (which may split escape
 * sequences anywhere) and it returns styled spans plus newline markers.
 */

export interface Style {
  fg: string | null;   // 'N' palette index (0-255) or '#rrggbb'
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  inverse: boolean;
}

export interface Span { text: string; style: Style }
export type Token = { type: 'text'; span: Span } | { type: 'newline' };

const DEFAULT: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false };

export class AnsiParser {
  private style: Style = { ...DEFAULT };
  private pending = '';   // partial escape sequence carried across chunks

  reset() { this.style = { ...DEFAULT }; this.pending = ''; }

  feed(chunk: string): Token[] {
    const out: Token[] = [];
    let text = this.pending + chunk;
    this.pending = '';
    let buf = '';
    const flush = () => { if (buf) { out.push({ type: 'text', span: { text: buf, style: { ...this.style } } }); buf = ''; } };

    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\x1b') {
        const next = text[i + 1];
        if (next === undefined) { this.pending = text.slice(i); break; }
        if (next === '[') {
          // CSI: ESC [ params final-byte(0x40-0x7e)
          let j = i + 2;
          while (j < text.length && !(text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e)) j++;
          if (j >= text.length) { this.pending = text.slice(i); break; }
          const params = text.slice(i + 2, j);
          const final = text[j];
          if (final === 'm') { flush(); this.applySgr(params); }
          i = j + 1;
          continue;
        }
        if (next === ']') {
          // OSC: ESC ] ... (BEL | ESC \)
          const bel = text.indexOf('\x07', i);
          const st = text.indexOf('\x1b\\', i);
          const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);
          if (end === -1) { this.pending = text.slice(i); break; }
          i = end + (text[end] === '\x07' ? 1 : 2);
          continue;
        }
        // Other two-byte escapes: skip
        i += 2;
        continue;
      }
      if (ch === '\n') { flush(); out.push({ type: 'newline' }); i++; continue; }
      if (ch === '\r' || ch === '\x07' || ch === '\x00') { i++; continue; }
      if (ch === '\t') { buf += '        '; i++; continue; }
      buf += ch;
      i++;
    }
    flush();
    return out;
  }

  private applySgr(params: string) {
    const p = params === '' ? [0] : params.split(';').map((x) => (x === '' ? 0 : parseInt(x, 10)));
    for (let k = 0; k < p.length; k++) {
      const n = p[k];
      if (n === 0) this.style = { ...DEFAULT };
      else if (n === 1) this.style.bold = true;
      else if (n === 2) this.style.dim = true;
      else if (n === 3) this.style.italic = true;
      else if (n === 4) this.style.underline = true;
      else if (n === 7) this.style.inverse = true;
      else if (n === 9) this.style.strike = true;
      else if (n === 22) { this.style.bold = false; this.style.dim = false; }
      else if (n === 23) this.style.italic = false;
      else if (n === 24) this.style.underline = false;
      else if (n === 27) this.style.inverse = false;
      else if (n === 29) this.style.strike = false;
      else if (n >= 30 && n <= 37) this.style.fg = String(n - 30);
      else if (n === 39) this.style.fg = null;
      else if (n >= 40 && n <= 47) this.style.bg = String(n - 40);
      else if (n === 49) this.style.bg = null;
      else if (n >= 90 && n <= 97) this.style.fg = String(n - 90 + 8);
      else if (n >= 100 && n <= 107) this.style.bg = String(n - 100 + 8);
      else if (n === 38 || n === 48) {
        const mode = p[k + 1];
        let colour: string | null = null;
        if (mode === 5) { colour = String(p[k + 2] ?? 0); k += 2; }
        else if (mode === 2) { colour = rgbHex(p[k + 2] ?? 0, p[k + 3] ?? 0, p[k + 4] ?? 0); k += 4; }
        if (n === 38) this.style.fg = colour; else this.style.bg = colour;
      }
    }
  }
}

function rgbHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** Convert a palette index 16-255 to a hex colour (xterm 256-colour cube + greys). */
export function xterm256(n: number): string {
  if (n < 16) return '';
  if (n >= 232) { const v = 8 + (n - 232) * 10; return rgbHex(v, v, v); }
  const idx = n - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  return rgbHex(steps[Math.floor(idx / 36)], steps[Math.floor(idx / 6) % 6], steps[idx % 6]);
}

/** Inline style for a span, using CSS variables for the 16 base colours so themes can restyle them. */
export function spanStyle(s: Style): React.CSSProperties {
  const css: React.CSSProperties = {};
  let fg = s.fg, bg = s.bg;
  if (s.inverse) { [fg, bg] = [bg ?? 'fg', fg ?? 'bg']; }
  // MUD convention: bold + base colour = bright colour.
  if (s.bold && fg !== null && /^[0-7]$/.test(fg)) fg = String(Number(fg) + 8);
  if (fg !== null) css.color = colourCss(fg);
  if (bg !== null) css.backgroundColor = colourCss(bg);
  if (s.bold) css.fontWeight = 600;
  if (s.dim) css.opacity = 0.6;
  if (s.italic) css.fontStyle = 'italic';
  const deco: string[] = [];
  if (s.underline) deco.push('underline');
  if (s.strike) deco.push('line-through');
  if (deco.length) css.textDecoration = deco.join(' ');
  return css;
}

function colourCss(c: string): string {
  if (c === 'fg') return 'var(--fg)';
  if (c === 'bg') return 'var(--bg)';
  if (c.startsWith('#')) return c;
  const n = Number(c);
  if (n < 16) return `var(--ansi-${n})`;
  return xterm256(n);
}

export const EMPTY_STYLE = DEFAULT;
