// Unit tests for emoji shortcode expansion (src/lib/emoji.ts): known :name: → emoji, unknown left
// alone, emoticons untouched, and the leading pose-colon preserved. Run: node scripts/test-emoji.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/emoji.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/emoji-test.mjs', logLevel: 'silent' });
const { expandEmoji, searchEmoji, EMOJI, nameForChar } = await import(pathToFileURL('dist-electron/emoji-test.mjs').href);

let n = 0;
const ok = (msg) => { n++; if (process.env.V) console.log('ok', msg); };
const eq = (a, b, msg) => { assert.equal(a, b); ok(msg); };

// known shortcodes convert
eq(expandEmoji('merry christmas :santa:'), 'merry christmas 🎅', 'santa mid-line');
eq(expandEmoji('say happy new year :tada:'), 'say happy new year 🎉', 'tada');
eq(expandEmoji('that :smiling_imp: look'), 'that 😈 look', 'smiling_imp');
eq(expandEmoji(':+1:'), '👍', '+1 alias at start (not a pose marker)');
eq(expandEmoji('great :+1: :100:'), 'great 👍 💯', 'two in a row incl +1 and 100');

// unknown shortcodes and colon-bearing game text are left exactly as typed
eq(expandEmoji('see you at :foobar: later'), 'see you at :foobar: later', 'unknown shortcode untouched');
eq(expandEmoji('the meeting is at 12:30 today'), 'the meeting is at 12:30 today', 'time untouched');
eq(expandEmoji('visit http://example.com now'), 'visit http://example.com now', 'url untouched');
eq(expandEmoji('exits: north, south'), 'exits: north, south', 'single colon untouched');

// emoticons (no closing colon) never match
eq(expandEmoji('haha :) and :D'), 'haha :) and :D', 'emoticons safe');

// ordinary poses (single leading colon, space-separated words) are untouched
eq(expandEmoji(':waves at the crowd'), ':waves at the crowd', 'plain :pose has one colon, untouched');
eq(expandEmoji(';grins'), ';grins', 'plain ;pose untouched');
// a pose body that carries a shortcode expands it but keeps its own leading colon
eq(expandEmoji(':picks up the :gift: and grins'), ':picks up the 🎁 and grins', 'pose keeps leading colon, mid emoji converts');
eq(expandEmoji('pose holds a :rose:'), 'pose holds a 🌹', 'verb pose converts its shortcode');
// a bare :name: at line start is treated as the emoji (as a pose it was only ever "Name santa:")
eq(expandEmoji(':santa:'), '🎅', 'bare :santa: at start becomes the emoji');

// case-insensitive name lookup
eq(expandEmoji('look :FIRE:'), 'look 🔥', 'uppercase name matches');

// no colons at all → identity (fast path)
eq(expandEmoji('nothing to do here'), 'nothing to do here', 'no colon identity');
eq(expandEmoji(''), '', 'empty string');

// table/helpers sanity
assert.equal(EMOJI['santa'], '🎅'); ok('EMOJI map santa');
assert.equal(EMOJI['thumbsup'], '👍'); ok('EMOJI alias thumbsup');
assert.equal(nameForChar('🎅'), 'santa'); ok('nameForChar santa');
assert.ok(searchEmoji('heart').some((e) => e.char === '❤️'), 'searchEmoji heart');
assert.ok(searchEmoji(':fire:').some((e) => e.char === '🔥'), 'searchEmoji strips colons');
assert.equal(searchEmoji('').length > 100, true, 'empty query returns all');

console.log(`emoji: ${n} checks passed`);
