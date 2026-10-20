/** Turns a line's spans into HTML for the colour log format; the file head carries the palette. */
import type { Span } from './ansi';
import { xterm256 } from './ansi';

const PALETTE = ['#3a3631', '#d9674f', '#86b867', '#e0b24a', '#6f9fd8', '#c58ad0', '#62b7b7', '#d6cfc2',
  '#6b655b', '#f0876d', '#a6d886', '#f5cf6c', '#93bdf0', '#dca9e6', '#86d6d6', '#fbf6ec'];

export const LOG_HTML_HEAD = [
  '<!doctype html><html><head><meta charset="utf-8"><title>Lantern log</title><style>',
  'body{background:#14120f;color:#e6dfd2;font-family:"Cascadia Mono",Consolas,monospace;font-size:14px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;padding:16px 24px}',
  '.cmd{color:#e8a94b}.note{color:#8f8778;font-style:italic}.hdr{color:#8f8778;margin:1em 0 .5em;border-top:1px solid #2f2b24;padding-top:.5em}',
  PALETTE.map((c, i) => `.f${i}{color:${c}}.g${i}{background:${c}}`).join(''),
  '</style></head><body>',
].join('');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colour(c: string): { cls?: string; css?: string } {
  if (/^\d+$/.test(c)) { const n = Number(c); return n < 16 ? { cls: String(n) } : { css: xterm256(n) }; }
  return { css: c };
}

export function spansToHtml(spans: readonly Span[]): string {
  let out = '';
  for (const sp of spans) {
    if (!sp.text) continue;
    const s = sp.style;
    let fg = s.fg, bg = s.bg;
    if (s.inverse) [fg, bg] = [bg ?? '7', fg ?? '0'];
    if (s.bold && fg !== null && /^[0-7]$/.test(fg)) fg = String(Number(fg) + 8);
    const classes: string[] = [];
    const css: string[] = [];
    if (fg !== null) { const c = colour(fg); if (c.cls) classes.push('f' + c.cls); else css.push(`color:${c.css}`); }
    if (bg !== null) { const c = colour(bg); if (c.cls) classes.push('g' + c.cls); else css.push(`background:${c.css}`); }
    if (s.bold) css.push('font-weight:600');
    if (s.dim) css.push('opacity:.6');
    if (s.italic) css.push('font-style:italic');
    if (s.underline || s.strike) css.push(`text-decoration:${[s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ')}`);
    const text = esc(sp.text);
    if (!classes.length && !css.length) { out += text; continue; }
    out += `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}>${text}</span>`;
  }
  return out;
}

export function lineHtml(kind: 'output' | 'command' | 'note', prefix: string, spans: readonly Span[]): string {
  const body = esc(prefix) + spansToHtml(spans);
  if (kind === 'command') return `<div class="cmd">&gt; ${body}</div>`;
  if (kind === 'note') return `<div class="note">${body}</div>`;
  return `<div>${body || '&nbsp;'}</div>`;
}
