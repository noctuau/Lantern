/**
 * Pueblo support: the handshake and a streaming translator from Pueblo's HTML-ish
 * markup to the ANSI escapes the output parser (src/lib/ansi.ts) already understands.
 * Pure TypeScript, no Node or DOM dependencies, so scripts/test-pueblo.mjs can run it.
 *
 * How Pueblo works (as MUSHclient implements it, ProcessPreviousLine.cpp / doc.cpp /
 * mxp/mxpOpenAtomic.cpp in Nick Gammon's source):
 *
 *  1. The game prints a line starting "This world is Pueblo 1.10 enhanced." (also 1.0
 *     and 2.50; compared case-insensitively).
 *  2. The client answers with the command line `PUEBLOCLIENT 1.10 md5="<32 hex>"`
 *     (a bare `PUEBLOCLIENT` for 1.0).
 *  3. The game then sends `</xch_mudtext>`; from there on `<tags>` are markup and `&lt;`
 *     style entities are characters, until the connection closes. `<img xch_mode=html>`
 *     keeps newlines meaningful, `<img xch_mode=purehtml>` makes them whitespace (only
 *     `<br>` breaks a line), `<img xch_mode=text>` is the same as html for us.
 *
 * Tags handled: b/strong, i/em, u, font color, a href / xch_cmd, br, p, hr, img
 * xch_mode, xch_page (reset). Everything else (xch_pane, xch_alert, send, samp, html,
 * body, head, title, pre, center, comments...) is dropped. A `<` that does not start a
 * tag (`<3`, `a < b`) is kept as text. Tags and entities split across packets are held
 * back until the rest arrives.
 */

export type PuebloEvent =
  | { kind: 'text'; text: string }     // translated text for the output parser
  | { kind: 'send'; line: string }     // a command line to send to the game
  | { kind: 'info'; text: string };    // a note for the user

export interface PuebloOptions {
  /** The world's switch. When false nothing is detected and text passes through untouched. */
  enabled: boolean;
  /** 32 hex characters for the md5= field of the reply; random by default. */
  hash?: () => string;
}

const ESC = String.fromCharCode(27);
const SGR = (s: string) => `${ESC}[${s}m`;
const ANNOUNCE = /this world is pueblo\s+(\d+(?:\.\d+)?)\s+enhanced/i;
const START = '</xch_mudtext>';
const MAX_TAG = 2048;          // a "tag" longer than this was never a tag; show the text
const MAX_TAIL = 400;          // how much of the current line we keep for the announcement check

export function randomHash(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return s;
}

/** The exact reply MUSHclient sends for an announced level. */
export function puebloReply(level: string, hash: string): string {
  if (level === '1.0' || level === '1') return 'PUEBLOCLIENT';
  const lvl = level === '2.50' || level === '2.5' ? '2.50' : '1.10';
  return `PUEBLOCLIENT ${lvl} md5="${hash}"`;
}

export class PuebloFilter {
  /** The game announced Pueblo and we replied. */
  replied = false;
  /** `</xch_mudtext>` seen: tags are being interpreted. */
  active = false;
  /** The announced version ('' until seen). */
  level = '';
  /** purehtml mode: bare newlines are whitespace, only <br> and <p> break lines. */
  suppressNewlines = false;

  private opts: PuebloOptions;
  private lineTail = '';
  private pending = '';
  private swallowNewline = false;
  private bold = 0;
  private italic = 0;
  private underline = 0;
  private fonts: (string | null)[] = [];
  private link: { href: string; text: string } | null = null;

  constructor(opts: PuebloOptions) { this.opts = opts; }

  feed(chunk: string): PuebloEvent[] {
    const events: PuebloEvent[] = [];
    const after: PuebloEvent[] = [];
    if (!this.opts.enabled) { if (chunk) events.push({ kind: 'text', text: chunk }); return events; }

    // 1. The announcement, wherever it falls in the stream (it may be split across packets).
    if (!this.replied) {
      const joined = this.lineTail + chunk;
      const m = ANNOUNCE.exec(joined);
      if (m) {
        this.replied = true;
        this.level = m[1];
        this.lineTail = '';
        after.push({ kind: 'send', line: puebloReply(this.level, (this.opts.hash ?? randomHash)()) });
        after.push({ kind: 'info', text: `Pueblo ${this.level} offered by the game; replied PUEBLOCLIENT.` });
      } else {
        const nl = joined.lastIndexOf('\n');
        this.lineTail = (nl === -1 ? joined : joined.slice(nl + 1)).slice(-MAX_TAIL);
      }
    }

    // 2. The text itself.
    let out = '';
    const emit = (s: string) => { out += s; if (this.link) this.link.text += s; };
    const text = this.pending + chunk;
    this.pending = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];

      if (!this.active) {
        if (ch === '<') {
          const rest = text.slice(i, i + START.length).toLowerCase();
          if (START.startsWith(rest)) {
            if (rest.length < START.length) { this.pending = text.slice(i); break; }
            this.active = true;
            i += START.length;
            events.push({ kind: 'info', text: 'Pueblo on: the game\'s formatting tags are now rendered.' });
            continue;
          }
        }
        out += ch; i++;
        continue;
      }

      if (ch === '<') {
        const tag = this.readTag(text, i);
        if (tag === 'partial') { this.pending = text.slice(i); break; }
        if (tag) { this.swallowNewline = false; out += this.applyTag(tag.raw); i = tag.end; continue; }
        this.swallowNewline = false;
        emit(ch); i++;
        continue;
      }

      if (ch === '&') {
        const m = /^&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/i.exec(text.slice(i, i + 12));
        if (m) { this.swallowNewline = false; emit(decodeEntity(m[1])); i += m[0].length; continue; }
        const tail = text.slice(i);
        if (tail.length < 12 && /^&(#x?[0-9a-f]*|[a-z][a-z0-9]*)?$/i.test(tail)) { this.pending = tail; break; }
        this.swallowNewline = false;
        emit(ch); i++;
        continue;
      }

      if (ch === '\r') { if (!this.swallowNewline) out += ch; i++; continue; }
      if (ch === '\n') {
        if (this.swallowNewline) { this.swallowNewline = false; i++; continue; }
        out += this.suppressNewlines ? ' ' : '\n';
        i++;
        continue;
      }

      this.swallowNewline = false;
      emit(ch); i++;
    }

    if (out) events.push({ kind: 'text', text: out });
    return events.concat(after);
  }

  /**
   * At a `<`: the tag's raw inside and the index after `>`, 'partial' when the rest has not
   * arrived yet, or null when this `<` is just a character.
   */
  private readTag(text: string, i: number): { raw: string; end: number } | 'partial' | null {
    const next = text[i + 1];
    if (next === undefined) return 'partial';
    if (next === '!') {
      if (text.startsWith('<!--', i) || text.length - i < 4) {
        if (text.length - i < 4) return 'partial';
        const close = text.indexOf('-->', i + 4);
        if (close === -1) return text.length - i > MAX_TAG ? null : 'partial';
        return { raw: '!--', end: close + 3 };
      }
      const gt = text.indexOf('>', i);
      if (gt === -1) return text.length - i > MAX_TAG ? null : 'partial';
      return { raw: '!', end: gt + 1 };
    }
    if (next !== '/' && !/[a-zA-Z]/.test(next)) return null;
    if (next === '/' && text[i + 2] !== undefined && !/[a-zA-Z]/.test(text[i + 2])) return null;
    const gt = text.indexOf('>', i);
    if (gt === -1) return text.length - i > MAX_TAG ? null : 'partial';
    return { raw: text.slice(i + 1, gt), end: gt + 1 };
  }

  /** The ANSI text a tag turns into ('' for most). */
  private applyTag(raw: string): string {
    if (raw.startsWith('!')) return '';
    const close = raw.startsWith('/');
    const body = (close ? raw.slice(1) : raw).trim().replace(/\/$/, '');
    const m = /^([a-zA-Z][\w:-]*)\s*([\s\S]*)$/.exec(body);
    if (!m) return '';
    const name = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    switch (name) {
      case 'b': case 'strong':
        if (close) { if (this.bold > 0) this.bold--; return this.bold ? '' : SGR('22'); }
        this.bold++; return SGR('1');
      case 'i': case 'em':
        if (close) { if (this.italic > 0) this.italic--; return this.italic ? '' : SGR('23'); }
        this.italic++; return SGR('3');
      case 'u':
        if (close) { if (this.underline > 0) this.underline--; return this.underline || this.link ? '' : SGR('24'); }
        this.underline++; return SGR('4');
      case 'br':
        return this.newline();
      case 'p': case 'hr':
        return this.newline();
      case 'font': {
        if (close) {
          const was = this.fonts.pop();
          if (!was) return '';   // the matching <font> set no colour (or there was none): nothing to undo
          const top = this.fonts.length ? this.fonts[this.fonts.length - 1] : null;
          return top ? fgSgr(top) : SGR('39');
        }
        const c = cssColour(attrs.color ?? attrs.colour ?? '');
        this.fonts.push(c);
        return c ? fgSgr(c) : '';
      }
      case 'a': {
        if (close) {
          const l = this.link;
          this.link = null;
          let s = this.underline ? '' : SGR('24');
          if (l && /^(https?:|mailto:)/i.test(l.href) && !l.text.includes(l.href)) s += ` [${l.href}]`;
          return s;
        }
        this.link = { href: attrs.href ?? '', text: '' };
        return SGR('4');
      }
      case 'img': {
        const mode = (attrs.xch_mode ?? '').toLowerCase();
        if (mode) this.suppressNewlines = mode === 'purehtml';
        return '';
      }
      case 'xch_page':
        this.bold = this.italic = this.underline = 0;
        this.fonts = [];
        this.link = null;
        return SGR('0');
      default:
        return '';
    }
  }

  /** Text held back for an unfinished tag or entity; call when the connection closes. */
  flush(): PuebloEvent[] {
    const p = this.pending;
    this.pending = '';
    this.lineTail = '';
    return p ? [{ kind: 'text', text: p }] : [];
  }

  private newline(): string {
    // `<br>` followed by the game's own CR LF is one line break, not two.
    this.swallowNewline = true;
    return '\n';
  }
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

const ENTITIES: Record<string, string> = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ',
  copy: String.fromCharCode(0xa9), reg: String.fromCharCode(0xae), trade: String.fromCharCode(0x2122),
  hellip: String.fromCharCode(0x2026), mdash: String.fromCharCode(0x2014), ndash: String.fromCharCode(0x2013),
  lsquo: String.fromCharCode(0x2018), rsquo: String.fromCharCode(0x2019),
  ldquo: String.fromCharCode(0x201c), rdquo: String.fromCharCode(0x201d),
  middot: String.fromCharCode(0xb7), bull: String.fromCharCode(0x2022), deg: String.fromCharCode(0xb0),
};

export function decodeEntity(name: string): string {
  if (name[0] === '#') {
    const n = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    if (!Number.isFinite(n) || n < 32 && n !== 9 || n > 0x10ffff) return '';
    return n === 160 ? ' ' : String.fromCodePoint(n);
  }
  const v = ENTITIES[name.toLowerCase()];
  return v !== undefined ? v : `&${name};`;
}

// The CSS named colours (what browsers, and so Pueblo, accept in <font color=...>).
const NAMED_COLOURS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff', beige: '#f5f5dc',
  bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc', crimson: '#dc143c', cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', darkgreen: '#006400', darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f',
  darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff',
  dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520', gray: '#808080',
  grey: '#808080', green: '#008000', greenyellow: '#adff2f', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3', lightgreen: '#90ee90', lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
  lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3',
  mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
  midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
  oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9',
  peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460',
  seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c',
  teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3',
  white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

/** '#rrggbb' for a Pueblo colour attribute (#rgb, #rrggbb, bare hex or a CSS colour name), else null. */
export function cssColour(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (/^#?[0-9a-f]{6}$/.test(s)) return '#' + s.replace('#', '');
  if (/^#?[0-9a-f]{3}$/.test(s)) { const h = s.replace('#', ''); return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  return NAMED_COLOURS[s] ?? null;
}

function fgSgr(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return SGR(`38;2;${r};${g};${b}`);
}
