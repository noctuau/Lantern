// Unit test for the streaming ANSI parser: colours, 256/truecolour, and sequences split across chunks.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
await build({ entryPoints: ['src/lib/ansi.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/ansi-test.mjs', logLevel: 'silent' });
const { AnsiParser, spanStyle } = await import(pathToFileURL('dist-electron/ansi-test.mjs').href);

const p = new AnsiParser();
let toks = p.feed('\x1b[1;31mRed bold\x1b[0m plain\n');
assert.equal(toks.length, 3);
assert.equal(toks[0].span.text, 'Red bold');
assert.equal(toks[0].span.style.fg, '1'); assert.equal(toks[0].span.style.bold, true);
assert.equal(spanStyle(toks[0].span.style).color, 'var(--ansi-9)'); // bold red -> bright red
assert.equal(toks[1].span.style.fg, null);
assert.equal(toks[2].type, 'newline');

// Escape split across two chunks
toks = p.feed('a\x1b[3');
assert.equal(toks.length, 1); assert.equal(toks[0].span.text, 'a');
toks = p.feed('4mb');
assert.equal(toks[0].span.text, 'b'); assert.equal(toks[0].span.style.fg, '4');

// 256 colour + truecolour + background
toks = p.feed('\x1b[38;5;208mx\x1b[48;2;10;20;30my\x1b[0m');
assert.equal(toks[0].span.style.fg, '208'); assert.equal(spanStyle(toks[0].span.style).color, '#ff8700');
assert.equal(toks[1].span.style.bg, '#0a141e');

// CR and non-SGR CSI are dropped; OSC skipped
toks = p.feed('\r\x1b[2Jclean\x1b]0;title\x07!');
assert.equal(toks.map(t => t.span?.text ?? '').join(''), 'clean!');
console.log('ansi parser: all assertions passed');
