// Verify the gradient port matches the original tool's output and that presets parse.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/gradient.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/gradient-test.mjs', logLevel: 'silent' });
const g = await import(pathToFileURL('dist-electron/gradient-test.mjs').href);

// The exact example from the original tool.
const out = g.makeGradient('The quick brown fox jumps over the lazy dog.', '255 254 253 252 251 250', { bothways: false, reverse: false, random: false });
assert.equal(out, '`255The qui`254ck brow`253n fox j`252umps ove`251r the l`250azy dog.`w', 'matches the original gradient output');

// Reverse reverses the code order.
const rev = g.makeGradient('abcdef', '1 2 3', { bothways: false, reverse: true, random: false });
assert.equal(rev, '`3ab`2cd`1ef`w');

// Both-ways appends the mirror.
const both = g.makeGradient('abcdef', '1 2 3', { bothways: true, reverse: false, random: false });
assert.equal(both.match(/`\d+/g).join(' '), '`1 `2 `3 `3 `2 `1');

// Codes are cleaned of stray characters.
assert.deepEqual(g.parseCodes(' 10, 20 ; 30 '), ['10', '20', '30']);

// Empty text / codes are safe.
assert.equal(g.makeGradient('', '1 2', { bothways: false, reverse: false, random: false }), '');
assert.equal(g.makeGradient('hi', '', { bothways: false, reverse: false, random: false }), 'hi');

// Preview parser: `NNN sets colour, `w resets.
const spans = g.parseBacktick('`196red`wplain');
assert.equal(spans.length, 2);
assert.equal(spans[0].text, 'red'); assert.equal(spans[0].hex, '#ff0000');
assert.equal(spans[1].text, 'plain'); assert.equal(spans[1].hex, null);

// Presets all parse to codes.
assert.ok(g.GRADIENT_PRESETS.length >= 80);
for (const p of g.GRADIENT_PRESETS) assert.ok(g.parseCodes(p.codes).length > 0, `preset ${p.name} has codes`);


// Presets from settings.json are cleaned: names unique and non-empty, codes tidied, missing list = built-ins.
assert.equal(g.normalizePresets(undefined).length, g.GRADIENT_PRESETS.length, 'no saved list means the built-ins');
assert.notEqual(g.normalizePresets(undefined), g.GRADIENT_PRESETS, 'and it is a copy, not the shared array');
assert.deepEqual(g.normalizePresets([]), [], 'an empty list stays empty');
const np = g.normalizePresets([
  { name: 'Mine', codes: ' 10, 20 ; 30 ' },
  { name: 'Mine', codes: '1 2' },
  { name: '  ', codes: '5' },
  { codes: '7' },
  null, 'junk', { name: 'No codes' }, { name: 'Bad codes', codes: 42 },
]);
assert.deepEqual(np, [
  { name: 'Mine', codes: '10 20 30' },
  { name: 'Mine (2)', codes: '1 2' },
  { name: 'Preset', codes: '5' },
  { name: 'Preset (2)', codes: '7' },
  { name: 'No codes', codes: '' },
  { name: 'Bad codes', codes: '' },
], 'duplicates get a suffix, blanks a default name, junk is dropped, codes are tidied');

console.log(`test-gradient: all assertions passed (${g.GRADIENT_PRESETS.length} presets)`);
