// Unit tests for the command-box in-game preview (src/lib/preview.ts): resolving the outgoing
// backtick codes, the `1..`6 toggle vs `NNN colour disambiguation, %r line breaks, and white speech.
// Run: node scripts/test-preview.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/preview.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/preview-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['shared/types.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/types-test.mjs', logLevel: 'silent' });
const { renderPreview } = await import(pathToFileURL('dist-electron/preview-test.mjs').href);
const { DEFAULT_MARKUP } = await import(pathToFileURL('dist-electron/types-test.mjs').href);

const M = DEFAULT_MARKUP; // boldOn `1 boldOff `4, italicOn `2 italicOff `5, underlineOn `3 underlineOff `6
let n = 0;
const ok = (msg) => { n++; if (process.env.V) console.log('ok', msg); };
// Flatten one display line into {text, fg, bold, italic, underline} tuples.
const line = (s, i = 0) => renderPreview(s, M)[i].map((sp) => ({ text: sp.text, fg: sp.style.fg, b: sp.style.bold, it: sp.style.italic, u: sp.style.underline }));
const text = (s) => renderPreview(s, M).map((ln) => ln.map((sp) => sp.text).join(''));

/* ---------- plain text ---------- */
{
  const l = line('hello');
  assert.equal(l.length, 1); assert.equal(l[0].text, 'hello'); assert.equal(l[0].fg, null); assert.equal(l[0].b, false);
  ok('plain text, no style');
}

/* ---------- bold / italic / underline toggles ---------- */
{
  const l = line('`1hi`4 there');
  assert.deepEqual(l.map((s) => [s.text, s.b]), [['hi', true], [' there', false]]);
  ok('`1..`4 is bold, not colour');
}
{
  const l = line('`2soft`5 `3line`6');
  assert.equal(l.find((s) => s.text === 'soft').it, true);
  assert.equal(l.find((s) => s.text === 'line').u, true);
  ok('italic and underline toggles');
}

/* ---------- colours, and the `1 vs `135 disambiguation ---------- */
{
  const l = line('`135x');
  assert.equal(l.length, 1); assert.equal(l[0].text, 'x'); assert.equal(l[0].fg, '135'); assert.equal(l[0].b, false);
  ok('`135 is xterm colour 135, not bold + "35"');
}
{
  const l = line('`#ff0000red`wplain');
  assert.equal(l[0].text, 'red'); assert.equal(l[0].fg, '#ff0000');
  assert.equal(l[1].text, 'plain'); assert.equal(l[1].fg, null); // `w resets colour
  ok('`#rrggbb truecolour, `w resets');
}

/* ---------- line breaks ---------- */
{
  assert.deepEqual(text('a%rb'), ['a', 'b']);
  assert.deepEqual(text('a\nb'), ['a', 'b']);
  ok('%r and real newlines both break the line');
}

/* ---------- white speech ---------- */
{
  const l = line('he said "hi" ok');
  const speech = l.find((s) => s.text.includes('hi'));
  assert.equal(speech.fg, '15'); // bright white
  assert.equal(l.find((s) => s.text.includes('said')).fg, null);
  assert.equal(l.find((s) => s.text.includes('ok')).fg, null);
  ok('quoted speech is white, the rest is default');
}
{
  // An explicit colour inside quotes wins over the white default.
  const l = line('"`201hi"');
  assert.equal(l.find((s) => s.text.startsWith('hi')).fg, '201');
  ok('a colour code inside speech overrides white');
}

console.log(`\n${n} preview assertions passed.`);
