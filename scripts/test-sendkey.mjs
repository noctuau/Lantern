// Verify when an Enter keypress sends, per send mode.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/sendkey.ts'], bundle: true, platform: 'browser', format: 'esm', outfile: 'dist-electron/sendkey-test.mjs', logLevel: 'silent' });
const { entrySends, SHORT_SEND_MAX } = await import(pathToFileURL('dist-electron/sendkey-test.mjs').href);

const s = (mode, mod, shift, value) => entrySends(mode, { mod, shift, value });
const long = 'x'.repeat(SHORT_SEND_MAX + 1);
const short = 'walks across the grid';

// enter mode: Enter sends, Shift+Enter is a new line.
assert.equal(s('enter', false, false, short), true);
assert.equal(s('enter', false, true, short), false);

// ctrl-enter mode: short single line sends on plain Enter...
assert.equal(s('ctrl-enter', false, false, short), true, 'short line sends on Enter');
assert.equal(s('ctrl-enter', false, false, 'x'.repeat(SHORT_SEND_MAX)), true, 'exactly the limit still sends');
// ...but a long or multi-line one needs Ctrl+Enter.
assert.equal(s('ctrl-enter', false, false, long), false, 'long line makes a new line');
assert.equal(s('ctrl-enter', false, false, 'a\nb'), false, 'multi-line makes a new line');
assert.equal(s('ctrl-enter', true, false, long), true, 'Ctrl+Enter sends a long line');
assert.equal(s('ctrl-enter', false, true, short), false, 'Shift+Enter never sends');

// button mode: plain Enter never sends, Ctrl+Enter does.
assert.equal(s('button', false, false, short), false);
assert.equal(s('button', true, false, short), true);
assert.equal(s('button', false, true, short), false);

console.log('test-sendkey: all assertions passed');
