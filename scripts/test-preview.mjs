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
const line = (s, opt = {}, i = 0) => renderPreview(s, M, opt)[i].map((sp) => ({ text: sp.text, fg: sp.style.fg, b: sp.style.bold, it: sp.style.italic, u: sp.style.underline }));
const text = (s, opt = {}) => renderPreview(s, M, opt).map((ln) => ln.map((sp) => sp.text).join(''));

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
{
  // A configured speech colour replaces the white default.
  const [sp] = renderPreview('"hi"', M, { speechColour: '117' })[0];
  assert.equal(sp.style.fg, '117');
  ok('speechColour sets the quote colour');
}

/* ---------- Haven @-tokens ---------- */
const opt = { character: 'Liesel' };
{
  assert.deepEqual(text('@me waves', opt), ['Liesel waves']);
  ok('@me expands to the character name');
}
{
  assert.deepEqual(text('@my hand', opt), ["Liesel's hand"]);
  ok('@my expands to the possessive');
}
{
  // Word boundary: @me must not fire inside a longer word.
  assert.deepEqual(text('@method @me', opt), ['@method Liesel']);
  ok('@me respects a word boundary');
}
{
  // @line is a hard break and swallows the spaces around it (the game trims them).
  assert.deepEqual(text('a @line b', opt), ['a', 'b']);
  ok('@line becomes a line break and trims surrounding spaces');
}
{
  // Two @line in a row make one blank line, no stray spaces.
  assert.deepEqual(text('a @line @line b', opt), ['a', '', 'b']);
  ok('@line @line is a blank line with no leftover spaces');
}
{
  // With no character name, @me/@my are left literal.
  assert.deepEqual(text('@me and @my'), ['@me and @my']);
  ok('@me/@my stay literal when no name is set');
}
{
  // The expanded name inside quotes still takes the speech colour.
  const l = renderPreview('"@me"', M, { character: 'Liesel' })[0];
  assert.equal(l.find((s) => s.text.includes('Liesel')).style.fg, '15');
  ok('an expanded @me inside speech is coloured');
}

/* ---------- pose verbs prepend the name ---------- */
{
  assert.deepEqual(text('emote tests some text', opt), ['Liesel tests some text']);
  ok('emote prepends the name with a space');
}
{
  assert.deepEqual(text('pose grins', opt), ['Liesel grins']);
  ok('pose prepends the name');
}
{
  assert.deepEqual(text(':waves', opt), ['Liesel waves']);
  ok(': prepends the name with a space');
}
{
  assert.deepEqual(text(";'s hand lifts", opt), ["Liesel's hand lifts"]);
  ok('; glues the name on for a possessive');
}
{
  // When @me / @my places the name, the verb is dropped but the name is NOT doubled.
  assert.deepEqual(text('emote @me waves', opt), ['Liesel waves']);
  ok('a pose with @me is not also auto-prepended');
}
{
  // Speech verbs are left as typed — we do not fake the "says," wrapper.
  assert.deepEqual(text('say hi', opt), ['say hi']);
  ok('non-pose verbs are shown literally');
}
{
  // With no character name, the pose verb is left literal (nothing to prepend).
  assert.deepEqual(text('emote waves'), ['emote waves']);
  ok('a pose is untouched when no name is set');
}
{
  // emotes must not match a longer word.
  assert.deepEqual(text('emotes are fun', opt), ['emotes are fun']);
  ok('emote respects a word boundary');
}

console.log(`\n${n} preview assertions passed.`);
