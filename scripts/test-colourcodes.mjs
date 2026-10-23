// Verify the backtick-code rebuild from coloured segments and rgb->hex parsing.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/selcolours.ts'], bundle: true, platform: 'browser', format: 'esm', outfile: 'dist-electron/selcolours-test.mjs', logLevel: 'silent' });
const { buildColourCodes, rgbToHex } = await import(pathToFileURL('dist-electron/selcolours-test.mjs').href);

assert.equal(rgbToHex('rgb(100, 255, 51)'), '#64ff33');
assert.equal(rgbToHex('rgba(255, 51, 109, 0.5)'), '#ff336d');
assert.equal(rgbToHex('not a colour'), null);

// A two-colour run + default tail, ending with a reset.
assert.equal(
  buildColourCodes([
    { text: 'Cl', hex: '#64ff33' },
    { text: 'ick ', hex: '#6af735' },
    { text: 'plain', hex: null },
  ]),
  '`#64ff33Cl`#6af735ick `wplain', // ends on the default run, which already reset with `w
);

// A run that is already default needs only a single reset, no trailing dup.
assert.equal(buildColourCodes([{ text: 'hi', hex: null }]), '`whi');
// Same colour across segments collapses to one code.
assert.equal(buildColourCodes([{ text: 'ab', hex: '#ff0000' }, { text: 'cd', hex: '#ff0000' }]), '`#ff0000abcd`w');
// Empty segments are skipped; empty input is empty.
assert.equal(buildColourCodes([]), '');
assert.equal(buildColourCodes([{ text: '', hex: '#fff' }]), '');

console.log('test-colourcodes: all assertions passed');
