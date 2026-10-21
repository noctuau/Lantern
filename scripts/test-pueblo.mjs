// Unit test for Pueblo support (shared/pueblo.ts): the handshake, the switch into HTML mode,
// each tag, entities, tags split across packets, and text that only looks like markup.
// Run: node scripts/test-pueblo.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['shared/pueblo.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/pueblo-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['src/lib/ansi.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/ansi-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['shared/types.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/types-test.mjs', logLevel: 'silent' });
const { PuebloFilter, puebloReply, cssColour, decodeEntity } = await import(pathToFileURL('dist-electron/pueblo-test.mjs').href);
const { AnsiParser } = await import(pathToFileURL('dist-electron/ansi-test.mjs').href);
const { normalizeWorld } = await import(pathToFileURL('dist-electron/types-test.mjs').href);

const ESC = '\x1b';
const HASH = '0123456789abcdef0123456789abcdef';
const fresh = (enabled = true) => new PuebloFilter({ enabled, hash: () => HASH });
const text = (events) => events.filter((e) => e.kind === 'text').map((e) => e.text).join('');
const sends = (events) => events.filter((e) => e.kind === 'send').map((e) => e.line);
const infos = (events) => events.filter((e) => e.kind === 'info').map((e) => e.text);
/** A filter already in HTML mode. */
const live = () => { const f = fresh(); f.feed('This world is Pueblo 1.10 enhanced.\r\n'); f.feed('</xch_mudtext><img xch_mode=html>'); return f; };
let n = 0;
const ok = () => { n++; };

/* ---------- world switch ---------- */
assert.equal(normalizeWorld({ id: 'w' }).mxp, true, 'default on (the switch is shared with MXP)');
assert.equal(normalizeWorld({ id: 'w', mxp: false }).mxp, false);
assert.equal(normalizeWorld({ id: 'w', pueblo: false }).mxp, false, 'the old field name still turns it off'); ok();

/* ---------- handshake ---------- */
let f = fresh();
let ev = f.feed('Welcome!\r\nThis world is Pueblo 1.10 enhanced.\r\n');
assert.equal(text(ev), 'Welcome!\r\nThis world is Pueblo 1.10 enhanced.\r\n', 'the announcement is still shown');
assert.deepEqual(sends(ev), [`PUEBLOCLIENT 1.10 md5="${HASH}"`]);
assert.equal(infos(ev).length, 1); assert.match(infos(ev)[0], /Pueblo 1\.10/);
assert.equal(f.replied, true); assert.equal(f.level, '1.10'); assert.equal(f.active, false, 'tags are not interpreted until </xch_mudtext>'); ok();
ev = f.feed('This world is Pueblo 1.10 enhanced.\r\n');
assert.deepEqual(sends(ev), [], 'replied once only'); ok();

f = fresh();
ev = f.feed('  this WORLD is pueblo 1.0 Enhanced\r\n');
assert.deepEqual(sends(ev), ['PUEBLOCLIENT'], 'case-insensitive, anywhere in the line; 1.0 gets the bare reply'); ok();
f = fresh();
ev = f.feed('This world is Pueblo 2.50 enhanced.\r\n');
assert.deepEqual(sends(ev), [`PUEBLOCLIENT 2.50 md5="${HASH}"`]); ok();
assert.equal(puebloReply('1.10', 'x'), 'PUEBLOCLIENT 1.10 md5="x"');
assert.equal(puebloReply('3.1', 'x'), 'PUEBLOCLIENT 1.10 md5="x"', 'an unknown level is answered as 1.10'); ok();

// Announcement split across packets
f = fresh();
ev = f.feed('This world is Pue');
assert.deepEqual(sends(ev), []); assert.equal(text(ev), 'This world is Pue');
ev = f.feed('blo 1.10 enhanced.\r\n');
assert.deepEqual(sends(ev), [`PUEBLOCLIENT 1.10 md5="${HASH}"`]); assert.equal(text(ev), 'blo 1.10 enhanced.\r\n'); ok();

// Switch off: nothing detected, nothing changed
f = fresh(false);
ev = f.feed('This world is Pueblo 1.10 enhanced.\r\n</xch_mudtext><img xch_mode=html>You say, "<i>test</i>"<br>\r\n');
assert.deepEqual(sends(ev), []); assert.deepEqual(infos(ev), []);
assert.equal(text(ev), 'This world is Pueblo 1.10 enhanced.\r\n</xch_mudtext><img xch_mode=html>You say, "<i>test</i>"<br>\r\n'); ok();

/* ---------- mode switch ---------- */
f = fresh();
f.feed('This world is Pueblo 1.10 enhanced.\r\n');
ev = f.feed('Before <i>not yet</i>.\r\n');
assert.equal(text(ev), 'Before <i>not yet</i>.\r\n', 'tags are literal text until the switch'); ok();
ev = f.feed('</xch_mudtext><img xch_mode=html>You say, "<i>test</i>"<br>\r\n');
assert.equal(f.active, true);
assert.equal(text(ev), `You say, "${ESC}[3mtest${ESC}[23m"\n`, 'tags become SGR; <br> + CR LF is one line break');
assert.match(infos(ev)[0], /Pueblo on/); ok();

// The switch marker split across packets, and in mixed case
f = fresh();
ev = f.feed('</XCH_mud');
assert.equal(text(ev), '', 'held back until it is clearly the marker or not');
ev = f.feed('text><img xch_mode=html><b>x</b>');
assert.equal(f.active, true); assert.equal(text(ev), `${ESC}[1mx${ESC}[22m`); ok();

// Something that starts like the marker but is not
f = fresh();
ev = f.feed('</xch_mud');
ev = f.feed('pie> is a tag nobody sends\r\n');
assert.equal(f.active, false); assert.equal(text(ev), '</xch_mudpie> is a tag nobody sends\r\n'); ok();

/* ---------- each tag ---------- */
f = live();
assert.equal(text(f.feed('<b>b</b><strong>s</strong>')), `${ESC}[1mb${ESC}[22m${ESC}[1ms${ESC}[22m`);
assert.equal(text(f.feed('<i>i</i><em>e</em>')), `${ESC}[3mi${ESC}[23m${ESC}[3me${ESC}[23m`);
assert.equal(text(f.feed('<u>u</u>')), `${ESC}[4mu${ESC}[24m`);
assert.equal(text(f.feed('<B>upper</B>')), `${ESC}[1mupper${ESC}[22m`, 'tag names are case-insensitive'); ok();
assert.equal(text(f.feed('<b><b>nested</b> still bold</b>')), `${ESC}[1m${ESC}[1mnested still bold${ESC}[22m`, 'nested bold closes once'); ok();
assert.equal(text(f.feed('</i>stray close')), `${ESC}[23mstray close`, 'an unmatched close still switches the style off (harmless, and safer)'); ok();

assert.equal(text(f.feed('a<br>b<br/>c<br />d')), 'a\nb\nc\nd');
assert.equal(text(f.feed('a<br>\r\nb<br>\nc<br>d')), 'a\nb\nc\nd', '<br> swallows exactly one following newline');
assert.equal(text(f.feed('a<br>\r\n\r\nb')), 'a\n\r\nb', 'a blank line after <br> survives (the parser drops the CR)');
assert.equal(text(f.feed('a\r\nb')), 'a\r\nb', 'bare newlines still break lines in html mode');
assert.equal(text(f.feed('<p>para</p>')), '\npara\n'); ok();

assert.equal(text(f.feed('<font color="#ff8700">amber</font>')), `${ESC}[38;2;255;135;0mamber${ESC}[39m`);
assert.equal(text(f.feed('<font color=red>red</font>')), `${ESC}[38;2;255;0;0mred${ESC}[39m`);
assert.equal(text(f.feed("<font color='#0f0'>short</font>")), `${ESC}[38;2;0;255;0mshort${ESC}[39m`);
assert.equal(text(f.feed('<font color=red>r<font color=blue>b</font>r</font>')), `${ESC}[38;2;255;0;0mr${ESC}[38;2;0;0;255mb${ESC}[38;2;255;0;0mr${ESC}[39m`, 'closing an inner font restores the outer colour');
assert.equal(text(f.feed('<font size=3>plain</font>')), 'plain', 'a font tag without a colour changes nothing');
assert.equal(text(f.feed('<font color=nosuchcolour>x</font>')), 'x'); ok();
assert.equal(cssColour('CornflowerBlue'), '#6495ed', 'CSS colour names, any case');
assert.equal(cssColour('notacolour'), null);
assert.equal(cssColour('Orange'), '#ffa500'); assert.equal(cssColour('ff8700'), '#ff8700'); ok();

assert.equal(text(f.feed('<a href="https://havenrpg.net">Haven</a>')), `${ESC}[4mHaven${ESC}[24m [https://havenrpg.net]`, 'link text is underlined and the URL follows it');
assert.equal(text(f.feed('<a href="https://havenrpg.net">https://havenrpg.net</a>')), `${ESC}[4mhttps://havenrpg.net${ESC}[24m`, 'no duplicate when the text is the URL');
assert.equal(text(f.feed('<a xch_cmd="look door">the door</a>')), `${ESC}[4mthe door${ESC}[24m`, 'a command link keeps its text');
assert.equal(text(f.feed('<u><a href="https://x.y">u</a> still</u>')), `${ESC}[4m${ESC}[4mu [https://x.y] still${ESC}[24m`, 'closing a link inside <u> keeps the underline'); ok();

assert.equal(text(f.feed('<img src="pic.gif">x<xch_page>y')), `x${ESC}[0my`, 'img dropped; xch_page resets');
assert.equal(text(f.feed('<xch_pane name=x>a</xch_pane><xch_alert>b</xch_alert><send href="look">c</send><samp>d</samp>')), 'abcd');
assert.equal(text(f.feed('<!-- a comment --><html><body>e</body></html>')), 'e');
assert.equal(text(f.feed('<i>unterminated at disconnect')), `${ESC}[3munterminated at disconnect`); ok();

// purehtml: newlines are whitespace
f = live();
f.feed('<img xch_mode=purehtml>');
assert.equal(f.suppressNewlines, true);
assert.equal(text(f.feed('one\r\ntwo<br>\r\nthree')), 'one\r two\nthree');
f.feed('<img xch_mode=text>');
assert.equal(f.suppressNewlines, false);
assert.equal(text(f.feed('one\r\ntwo')), 'one\r\ntwo'); ok();

/* ---------- entities ---------- */
f = live();
assert.equal(text(f.feed('&lt;b&gt; &amp; &quot;q&quot; &apos;a&apos; x&nbsp;y &#65;&#x42; &mdash; &bogus;')), '<b> & "q" \'a\' x y AB — &bogus;');
assert.equal(text(f.feed('fish &chips')), 'fish ', 'a possible entity at the end of a packet waits for the next one');
assert.equal(text(f.feed(' please')), '&chips please', 'and stays as typed when no ; follows');
assert.equal(text(f.feed('tea &co')), 'tea ');
assert.equal(text(f.flush()), '&co', 'flush() at disconnect returns what was held back');
assert.equal(text(f.feed('a & b, AT&T, && x')), 'a & b, AT&T, && x', 'ampersands that cannot start an entity are text');
assert.equal(decodeEntity('#160'), ' '); assert.equal(decodeEntity('#7'), '', 'control codes are dropped'); ok();

/* ---------- split across two chunks ---------- */
f = live();
ev = f.feed('The <i>sp');
assert.equal(text(ev), `The ${ESC}[3msp`);
ev = f.feed('lit</i> tag');
assert.equal(text(ev), `lit${ESC}[23m tag`); ok();
f = live();
ev = f.feed('<fo');
assert.equal(text(ev), '', 'an unfinished tag is held back');
ev = f.feed('nt color=red>r</font>');
assert.equal(text(ev), `${ESC}[38;2;255;0;0mr${ESC}[39m`); ok();
f = live();
ev = f.feed('a &am');
assert.equal(text(ev), 'a ');
ev = f.feed('p; b');
assert.equal(text(ev), '& b', 'an entity split across packets'); ok();
f = live();
ev = f.feed('x<br>');
assert.equal(text(ev), 'x\n');
ev = f.feed('\r\ny');
assert.equal(text(ev), 'y', 'the CR LF after <br> is swallowed even in the next packet'); ok();

/* ---------- ANSI colour and <i> on one line, through the real parser ---------- */
f = live();
const parser = new AnsiParser();
const toks = parser.feed(text(f.feed(`${ESC}[32mGreen with <i>italics</i> inside${ESC}[0m.<br>\r\n`)));
const spans = toks.filter((t) => t.type === 'text').map((t) => t.span);
assert.deepEqual(spans.map((s) => s.text), ['Green with ', 'italics', ' inside', '.']);
assert.equal(spans[0].style.fg, '2'); assert.equal(spans[0].style.italic, false);
assert.equal(spans[1].style.fg, '2', 'the colour survives the italic span'); assert.equal(spans[1].style.italic, true);
assert.equal(spans[2].style.italic, false); assert.equal(spans[2].style.fg, '2');
assert.equal(toks[toks.length - 1].type, 'newline'); ok();
const toks2 = parser.feed(text(f.feed('You say, "<i>test</i>"<br>\r\n')));
assert.deepEqual(toks2.filter((t) => t.type === 'text').map((t) => [t.span.text, t.span.style.italic]), [['You say, "', false], ['test', true], ['"', false]]); ok();

/* ---------- text that only looks like markup ---------- */
f = live();
assert.equal(text(f.feed('I <3 you')), 'I <3 you');
assert.equal(text(f.feed('a < b and b > a')), 'a < b and b > a');
assert.equal(text(f.feed('1 << 2, x <= y, <> and < at the end')), '1 << 2, x <= y, <> and < at the end');
assert.equal(text(f.feed('</3 broken heart')), '</3 broken heart'); ok();
ev = f.feed('x <');
assert.equal(text(ev), 'x ', 'a lone < at the end of a packet waits for the next one');
ev = f.feed(' y');
assert.equal(text(ev), '< y'); ok();
// A "tag" that never closes is given up on and shown as text
f = live();
ev = f.feed('<i ' + 'x'.repeat(3000));
assert.equal(text(ev).startsWith('<i xxx'), true); ok();

console.log(`pueblo: all ${n} groups passed`);
