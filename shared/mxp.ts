/**
 * MXP (MUD eXtension Protocol, telnet option 91): a streaming translator from the tags a game
 * sends once MXP is negotiated to the ANSI escapes the output parser (src/lib/ansi.ts) already
 * understands. Pure TypeScript; scripts/test-mxp.mjs runs it under Node.
 *
 * The parts of the spec (zuggsoft.com/zmud/mxp.htm) this covers:
 *
 *  - Line modes, sent as ESC [ N z: 0 open (only the formatting tags B I U S H COLOR FONT are
 *    tags; any other `<` is text), 1 secure (every tag), 2 locked (no tags, no entities),
 *    3 reset, 4 secure for the next tag only, 5/6/7 make open/secure/locked the default,
 *    10..99 are purpose-tagged lines (treated as secure). A newline puts the mode back to the
 *    default (open until a 5/6/7 says otherwise) and closes formatting opened on an open line.
 *  - Tags: B/BOLD/STRONG, I/ITALIC/EM, U/UNDERLINE, S/STRIKEOUT, H/HIGH, C/COLOR fore back,
 *    FONT color back, A href, SEND href (shown underlined; the command itself is not clickable
 *    yet), BR, SBR, HR, P (newlines inside become spaces), NOBR, VERSION and SUPPORT (answered),
 *    <!ELEMENT> definitions (expanded when the game later uses the element), and every other
 *    tag (VAR, EXPIRE, IMAGE, SOUND, GAUGE, STAT, FRAME, DEST, RName…) dropped with its
 *    attributes while its text stays.
 *  - Entities &lt; &gt; &amp; &quot; &nbsp; &#NN; in open and secure lines.
 *  - Tags, entities and escapes split across packets are held back until the rest arrives.
 */
import { type PuebloEvent, decodeEntity, cssColour, fgSgr } from './pueblo';

export type MxpEvent = PuebloEvent;

export interface MxpOptions {
  /** Lantern's version, reported in the VERSION reply. */
  clientVersion?: string;
}

const ESC = String.fromCharCode(27);
const SGR = (s: string) => `${ESC}[${s}m`;
const MAX_TAG = 4096;

type Mode = 'open' | 'secure' | 'locked';

const OPEN_TAGS = new Set(['b', 'bold', 'strong', 'i', 'italic', 'em', 'u', 'underline', 's', 'strikeout', 'strike', 'h', 'high', 'c', 'color', 'colour', 'font']);
/** What the SUPPORTS reply claims. Only what this file renders. */
export const SUPPORTED = ['b', 'i', 'u', 's', 'h', 'c', 'color', 'font', 'em', 'strong', 'a', 'send', 'br', 'sbr', 'hr', 'p', 'nobr', 'version', 'support', 'element'];

interface Colour { fg: string | null; bg: string | null }

export class MxpFilter {
  /** Set true once the telnet layer has negotiated option 91; until then text passes through. */
  on = false;
  mode: Mode = 'open';
  defaultMode: Mode = 'open';

  private opts: MxpOptions;
  private tempSecure = false;
  private tempClose: string | null = null;
  private pending = '';
  private bold = 0;
  private italic = 0;
  private underline = 0;
  private strike = 0;
  private colours: Colour[] = [];
  private link: { href: string; text: string; url: boolean } | null = null;
  private paragraph = false;
  private skipNewline = false;
  private elements = new Map<string, string[]>();   // user element -> the tags its definition opens
  private outbox: string[] = [];

  constructor(opts: MxpOptions = {}) { this.opts = opts; }

  feed(chunk: string): MxpEvent[] {
    if (!this.on) return chunk ? [{ kind: 'text', text: chunk }] : [];
    const events: MxpEvent[] = [];
    let out = '';
    const emit = (s: string) => { out += s; if (this.link) this.link.text += s; };
    const text = this.pending + chunk;
    this.pending = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];

      if (ch === ESC) {
        if (text[i + 1] === undefined) { this.pending = text.slice(i); break; }
        if (text[i + 1] !== '[') { out += text.slice(i, i + 2); i += 2; continue; }
        let j = i + 2;
        while (j < text.length && !(text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e)) j++;
        if (j >= text.length) { this.pending = text.slice(i); break; }
        if (text[j] === 'z') { out += this.setMode(parseInt(text.slice(i + 2, j), 10) || 0); i = j + 1; continue; }
        out += text.slice(i, j + 1);   // an SGR or other CSI: the renderer's parser handles it
        i = j + 1;
        continue;
      }

      const locked = this.mode === 'locked' && !this.tempSecure;

      if (ch === '<' && !locked) {
        const tag = this.readTag(text, i);
        if (tag === 'partial') { this.pending = text.slice(i); break; }
        if (tag) {
          const secure = this.tempSecure || this.mode === 'secure';
          const name = tagName(tag.raw);
          const closing = tag.raw.startsWith('/');
          // ESC[4z covers the next tag; its matching close tag is let through as well.
          if (secure || (name && OPEN_TAGS.has(name)) || (closing && name === this.tempClose)) {
            if (this.tempSecure && !closing) this.tempClose = name;
            else if (closing && name === this.tempClose) this.tempClose = null;
            this.tempSecure = false;
            out += this.applyTag(tag.raw);
            i = tag.end;
            continue;
          }
        }
        emit(ch); i++;   // not a tag here: a character
        continue;
      }

      if (ch === '&' && !locked) {
        const m = /^&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/i.exec(text.slice(i, i + 12));
        if (m) { emit(decodeEntity(m[1])); i += m[0].length; continue; }
        const tail = text.slice(i);
        if (tail.length < 12 && /^&(#x?[0-9a-f]*|[a-z][a-z0-9]*)?$/i.test(tail)) { this.pending = tail; break; }
        emit(ch); i++;
        continue;
      }

      if (ch === '\n') {
        if (this.skipNewline) { this.skipNewline = false; i++; continue; }
        if (this.paragraph) { out += ' '; i++; continue; }
        // End of line: formatting opened on an open line ends with it; the mode goes back to the default.
        if (this.mode === 'open') out += this.closeAll();
        this.mode = this.defaultMode;
        this.tempSecure = false;
        out += ch; i++;
        continue;
      }

      emit(ch); i++;
    }

    if (out) events.push({ kind: 'text', text: out });
    for (const line of this.outbox) events.push({ kind: 'send', line });
    this.outbox = [];
    return events;
  }

  /** Text held back for an unfinished tag, entity or escape; call when the connection closes. */
  flush(): MxpEvent[] {
    const p = this.pending;
    this.pending = '';
    return p ? [{ kind: 'text', text: p }] : [];
  }

  private setMode(n: number): string {
    let out = '';
    switch (n) {
      case 0: out = this.mode === 'open' ? '' : ''; this.mode = 'open'; break;
      case 1: this.mode = 'secure'; break;
      case 2: this.mode = 'locked'; break;
      case 3: out = this.closeAll() + SGR('0'); this.mode = this.defaultMode = 'open'; this.paragraph = false; break;
      case 4: this.tempSecure = true; break;
      case 5: this.mode = this.defaultMode = 'open'; break;
      case 6: this.mode = this.defaultMode = 'secure'; break;
      case 7: this.mode = this.defaultMode = 'locked'; break;
      default: if (n >= 10) this.mode = 'secure';   // room name/description/exits, welcome text, game-specific lines
    }
    return out;
  }

  /** Close every open style and return the escapes that undo them on screen. */
  private closeAll(): string {
    let s = '';
    if (this.bold) s += SGR('22');
    if (this.italic) s += SGR('23');
    if (this.underline || this.link) s += SGR('24');
    if (this.strike) s += SGR('29');
    if (this.colours.some((c) => c.fg)) s += SGR('39');
    if (this.colours.some((c) => c.bg)) s += SGR('49');
    this.bold = this.italic = this.underline = this.strike = 0;
    this.colours = [];
    this.link = null;
    return s;
  }

  /**
   * At a `<`: the tag's raw inside and the index after its `>` (quotes may hide a `>`), 'partial'
   * when the rest has not arrived yet, or null when this `<` is just a character.
   */
  private readTag(text: string, i: number): { raw: string; end: number } | 'partial' | null {
    const next = text[i + 1];
    if (next === undefined) return 'partial';
    if (next === '!') {
      if (text.length - i < 4) return 'partial';
      if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i + 4);
        if (close === -1) return text.length - i > MAX_TAG ? null : 'partial';
        return { raw: '!--', end: close + 3 };
      }
    } else {
      if (next !== '/' && !/[a-zA-Z]/.test(next)) return null;
      if (next === '/') {
        if (text[i + 2] === undefined) return 'partial';
        if (!/[a-zA-Z]/.test(text[i + 2])) return null;
      }
    }
    let q: string | null = null;
    for (let j = i + 1; j < text.length; j++) {
      const c = text[j];
      if (q) { if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '>') return { raw: text.slice(i + 1, j), end: j + 1 };
      else if (c === '\n') return null;   // a tag never spans a line: this `<` was text
    }
    return text.length - i > MAX_TAG ? null : 'partial';
  }

  /** The ANSI text a tag turns into ('' for most). */
  private applyTag(raw: string): string {
    if (raw.startsWith('!')) { this.define(raw); return ''; }
    const close = raw.startsWith('/');
    const body = (close ? raw.slice(1) : raw).trim().replace(/\/$/, '');
    const m = /^([a-zA-Z][\w:.-]*)\s*([\s\S]*)$/.exec(body);
    if (!m) return '';
    const name = m[1].toLowerCase();
    const args = parseArgs(m[2]);
    const pos = args.positional;
    switch (name) {
      case 'b': case 'bold': case 'strong': case 'h': case 'high':
        if (close) { if (this.bold > 0) this.bold--; return this.bold ? '' : SGR('22'); }
        this.bold++; return SGR('1');
      case 'i': case 'italic': case 'em':
        if (close) { if (this.italic > 0) this.italic--; return this.italic ? '' : SGR('23'); }
        this.italic++; return SGR('3');
      case 'u': case 'underline':
        if (close) { if (this.underline > 0) this.underline--; return this.underline || this.link ? '' : SGR('24'); }
        this.underline++; return SGR('4');
      case 's': case 'strike': case 'strikeout':
        if (close) { if (this.strike > 0) this.strike--; return this.strike ? '' : SGR('29'); }
        this.strike++; return SGR('9');
      case 'c': case 'color': case 'colour':
        return close ? this.popColour() : this.pushColour(args.named.fore ?? args.named.color ?? pos[0] ?? '', args.named.back ?? pos[1] ?? '');
      case 'font':
        // <FONT face size color back>: the face and size mean nothing in a monospace pane.
        return close ? this.popColour() : this.pushColour(args.named.color ?? args.named.fore ?? '', args.named.back ?? '');
      case 'a': case 'send': {
        if (close) {
          const l = this.link;
          this.link = null;
          if (!l) return '';
          let s = this.underline ? '' : SGR('24');
          if (l.url && !l.text.includes(l.href)) s += ` [${l.href}]`;
          return s;
        }
        const href = args.named.href ?? pos[0] ?? '';
        this.link = { href, text: '', url: name === 'a' && /^(https?:|mailto:)/i.test(href) };
        return SGR('4');
      }
      case 'br': case 'hr': return '\n';
      case 'sbr': return ' ';
      case 'p': this.paragraph = !close; return '';
      case 'nobr': if (!close) this.skipNewline = true; return '';
      case 'version':
        if (!close) this.outbox.push(`${ESC}[1z<VERSION MXP=1.0 STYLE=1.0 CLIENT=Lantern VERSION=${this.opts.clientVersion ?? '0'} REGISTERED=yes>`);
        return '';
      case 'support': {
        if (close) return '';
        const asked = pos.map((p) => p.replace(/^[+-]/, '').toLowerCase()).filter(Boolean);
        const list = asked.length
          ? asked.map((p) => (SUPPORTED.includes(p.replace(/\..*$/, '')) ? `+${p}` : `-${p}`))
          : SUPPORTED.map((p) => `+${p}`);
        this.outbox.push(`${ESC}[1z<SUPPORTS ${list.join(' ')}>`);
        return '';
      }
      default: {
        // A user element the game defined with <!ELEMENT>: open or close what its definition says.
        const def = this.elements.get(name);
        if (!def) return '';
        if (close) return def.slice().reverse().map((t) => this.applyTag('/' + t)).join('');
        return def.map((t) => this.applyTag(t)).join('');
      }
    }
  }

  /** <!ELEMENT name "<COLOR red><B>" ...>: remember the tags the definition opens. Everything else in <!…> is ignored. */
  private define(raw: string) {
    const m = /^!element\s+([a-zA-Z][\w.-]*)\s*(?:"([^"]*)"|'([^']*)'|(\S+))?/i.exec(raw);
    if (!m) return;
    const name = m[1].toLowerCase();
    const def = m[2] ?? m[3] ?? m[4] ?? '';
    const tags: string[] = [];
    for (const t of def.matchAll(/<([^>]+)>/g)) {
      const inner = t[1].trim();
      if (inner.startsWith('/') || inner.startsWith('!')) continue;
      const n = tagName(inner);
      if (n && (OPEN_TAGS.has(n) || n === 'a' || n === 'send')) tags.push(inner);
    }
    this.elements.set(name, tags);
  }

  private pushColour(fore: string, back: string): string {
    const c: Colour = { fg: cssColour(fore), bg: cssColour(back) };
    this.colours.push(c);
    return (c.fg ? fgSgr(c.fg) : '') + (c.bg ? bgSgr(c.bg) : '');
  }

  private popColour(): string {
    const was = this.colours.pop();
    if (!was) return '';
    let s = '';
    if (was.fg) { const top = [...this.colours].reverse().find((c) => c.fg); s += top ? fgSgr(top.fg!) : SGR('39'); }
    if (was.bg) { const top = [...this.colours].reverse().find((c) => c.bg); s += top ? bgSgr(top.bg!) : SGR('49'); }
    return s;
  }
}

function tagName(raw: string): string | null {
  const m = /^\/?\s*([a-zA-Z][\w:.-]*)/.exec(raw);
  return m ? m[1].toLowerCase() : null;
}

/** MXP arguments: name=value pairs (quoted or bare) plus positional values in order. */
export function parseArgs(s: string): { named: Record<string, string>; positional: string[] } {
  const named: Record<string, string> = {};
  const positional: string[] = [];
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))|"([^"]*)"|'([^']*)'|([^\s"'>=]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) named[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    else positional.push(m[5] ?? m[6] ?? m[7] ?? '');
  }
  return { named, positional };
}

function bgSgr(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return SGR(`48;2;${r};${g};${b}`);
}
