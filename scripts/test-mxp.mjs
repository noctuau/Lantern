// Unit test for MXP support (shared/mxp.ts): line modes, each tag, entities, VERSION/SUPPORT
// replies, user elements, tags split across packets, and text that only looks like markup.
// Also checks the telnet engine answers IAC DO/WILL MXP and reports offers.
// Run: node scripts/test-mxp.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

await build({ entryPoints: ['shared/mxp.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/mxp-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['src/lib/ansi.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/ansi-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['shared/types.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/types-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['electron/telnet.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/telnet-test.mjs', logLevel: 'silent', external: ['electron'] });
const { MxpFilter, parseArgs, SUPPORTED } = await import(pathToFileURL('dist-electron/mxp-test.mjs').href);
const { AnsiParser } = await import(pathToFileURL('dist-electron/ansi-test.mjs').href);
const { normalizeWorld } = await import(pathToFileURL('dist-electron/types-test.mjs').href);
const { TelnetSession, IAC, WILL, WONT, DO, DONT, OPT } = await import(pathToFileURL('dist-electron/telnet-test.mjs').href);

const ESC = '\x1b';
const text = (events) => events.filter((e) => e.kind === 'text').map((e) => e.text).join('');
const sends = (events) => events.filter((e) => e.kind === 'send').map((e) => e.line);
const live = () => { const f = new MxpFilter({ clientVersion: '9.9.9' }); f.on = true; return f; };
let n = 0;
const ok = () => { n++; };

/* ---------- world switch ---------- */
assert.equal(normalizeWorld({ id: 'w' }).mxp, true, 'default on');
assert.equal(normalizeWorld({ id: 'w', mxp: false }).mxp, false);
assert.equal(normalizeWorld({ id: 'w', pueblo: false }).mxp, false, 'the one-commit-old name still turns it off');
assert.equal(normalizeWorld({ id: 'w', mxp: 'yes' }).mxp, true, 'junk values fall back to on'); ok();

/* ---------- before negotiation: untouched ---------- */
let f = new MxpFilter();
assert.equal(text(f.feed(`${ESC}[1z<I>x</I> &amp;`)), `${ESC}[1z<I>x</I> &amp;`, 'nothing happens until MXP is negotiated'); ok();

/* ---------- open mode: only formatting tags ---------- */
f = live();
assert.equal(text(f.feed('You say, "<I>test</I>"\r\n')), `You say, "${ESC}[3mtest${ESC}[23m"\r\n`, 'open mode renders <I>');
assert.equal(text(f.feed('<B>b</B><STRONG>s</STRONG><U>u</U><S>s</S><H>h</H><EM>e</EM>')),
  `${ESC}[1mb${ESC}[22m${ESC}[1ms${ESC}[22m${ESC}[4mu${ESC}[24m${ESC}[9ms${ESC}[29m${ESC}[1mh${ESC}[22m${ESC}[3me${ESC}[23m`); ok();
assert.equal(text(f.feed('<SEND href="look">not open</SEND> <bogus>x</bogus> <3 a < b\r\n')), '<SEND href="look">not open</SEND> <bogus>x</bogus> <3 a < b\r\n', 'secure and unknown tags are text on an open line'); ok();
assert.equal(text(f.feed('<COLOR red>r</COLOR> <C #ff8700 #303030>c</C> <FONT color=cornflowerblue back=black>f</FONT>')),
  `${ESC}[38;2;255;0;0mr${ESC}[39m ${ESC}[38;2;255;135;0m${ESC}[48;2;48;48;48mc${ESC}[39m${ESC}[49m ${ESC}[38;2;100;149;237m${ESC}[48;2;0;0;0mf${ESC}[39m${ESC}[49m`); ok();
assert.equal(text(f.feed('<COLOR red>r<COLOR blue>b</COLOR>r</COLOR>')), `${ESC}[38;2;255;0;0mr${ESC}[38;2;0;0;255mb${ESC}[38;2;255;0;0mr${ESC}[39m`, 'closing an inner colour restores the outer one');
assert.equal(text(f.feed('<COLOR fore=red back=navy>x</COLOR>')), `${ESC}[38;2;255;0;0m${ESC}[48;2;0;0;128mx${ESC}[39m${ESC}[49m`); ok();

// Formatting left open on an open line ends with the line
assert.equal(text(f.feed('<I>left open\r\nnext line\r\n')), `${ESC}[3mleft open\r${ESC}[23m\nnext line\r\n`); ok();

/* ---------- line modes ---------- */
f = live();
assert.equal(text(f.feed(`${ESC}[1z<SEND href="look sign">sign</SEND> <A href="https://x.y">site</A>\r\n`)),
  `${ESC}[4msign${ESC}[24m ${ESC}[4msite${ESC}[24m [https://x.y]\r\n`, 'secure line: SEND shows its text, A shows text + URL');
assert.equal(f.mode, 'open', 'back to open after the newline'); ok();
assert.equal(text(f.feed(`${ESC}[2z<I>x</I> &amp;\r\n<I>y</I>`)), `<I>x</I> &amp;\r\n${ESC}[3my${ESC}[23m`, 'locked line: nothing is markup; the next line is open again'); ok();
assert.equal(text(f.feed(`${ESC}[6z<SEND x>a</SEND>\r\n<SEND y>b</SEND>\r\n${ESC}[5z<SEND z>c</SEND>`)),
  `${ESC}[4ma${ESC}[24m\r\n${ESC}[4mb${ESC}[24m\r\n<SEND z>c</SEND>`, 'lock secure persists across lines until lock open'); ok();
assert.equal(text(f.feed(`${ESC}[7za <B>b</B>\r\nc\r\n${ESC}[3z<I>d</I>`)), `a <B>b</B>\r\nc\r\n${ESC}[0m${ESC}[3md${ESC}[23m`, 'lock locked, then reset returns to open'); ok();
assert.equal(text(f.feed(`${ESC}[4z<SEND q>t</SEND> <SEND q>u</SEND>`)), `${ESC}[4mt${ESC}[24m <SEND q>u</SEND>`, 'temp secure covers one tag'); ok();
assert.equal(text(f.feed(`${ESC}[10z<RName>Room</RName>\r\n`)), 'Room\r\n', 'room-name lines are secure; unknown tags dropped');
assert.equal(text(f.feed(`${ESC}[1z<!ELEMENT RName '<COLOR #ffd27f><B>' FLAG="RoomName">`)), '', 'a definition shows nothing');
assert.equal(text(f.feed(`${ESC}[1z<RName>Room</RName>\r\n`)), `${ESC}[38;2;255;210;127m${ESC}[1mRoom${ESC}[22m${ESC}[39m\r\n`, 'a defined element opens and closes what its definition says'); ok();
assert.equal(text(f.feed(`${ESC}[1z<VAR x>1</VAR><EXPIRE y><IMAGE a.png><SOUND b.wav><GAUGE hp>z<!-- c --><!ENTITY e "v">\r\n`)), '1z\r\n', 'the rest of MXP is dropped, text kept'); ok();
assert.equal(text(f.feed(`${ESC}[1zone<BR>two<SBR>three<HR>four<NOBR>\r\nfive <P>a\r\nb</P>\r\n`)), 'one\ntwo three\nfour\rfive a\r b\r\n', 'BR SBR HR NOBR P (the parser drops the CRs)'); ok();
assert.equal(text(f.feed(`${ESC}[1;31mred${ESC}[0m ${ESC}[1zx`)), `${ESC}[1;31mred${ESC}[0m x`, 'SGR passes through untouched'); ok();

/* ---------- VERSION and SUPPORT ---------- */
f = live();
let ev = f.feed(`${ESC}[1z<VERSION>`);
assert.deepEqual(sends(ev), [`${ESC}[1z<VERSION MXP=1.0 STYLE=1.0 CLIENT=Lantern VERSION=9.9.9 REGISTERED=yes>`]); assert.equal(text(ev), ''); ok();
ev = f.feed(`${ESC}[1z<SUPPORT>`);
assert.deepEqual(sends(ev), [`${ESC}[1z<SUPPORTS ${SUPPORTED.map((s) => '+' + s).join(' ')}>`]); ok();
ev = f.feed(`${ESC}[1z<SUPPORT image +send "color.*">`);
assert.deepEqual(sends(ev), [`${ESC}[1z<SUPPORTS -image +send +color.*>`]); ok();
ev = f.feed('\n<VERSION>');
assert.deepEqual(sends(ev), [], 'VERSION is a secure tag: text on the open line after a newline'); assert.equal(text(ev), '\n<VERSION>'); ok();

/* ---------- entities ---------- */
f = live();
assert.equal(text(f.feed('&lt;b&gt; &amp; &quot;q&quot; x&nbsp;y &#65;&#x42; &bogus; AT&T done')), '<b> & "q" x y AB &bogus; AT&T done'); ok();

/* ---------- split across packets ---------- */
f = live();
assert.equal(text(f.feed('The <I>sp')), `The ${ESC}[3msp`);
assert.equal(text(f.feed('lit</I> tag')), `lit${ESC}[23m tag`); ok();
assert.equal(text(f.feed('<CO')), '', 'an unfinished tag waits');
assert.equal(text(f.feed('LOR red>r</COLOR>')), `${ESC}[38;2;255;0;0mr${ESC}[39m`); ok();
assert.equal(text(f.feed(`a${ESC}[1`)), 'a', 'an unfinished escape waits');
assert.equal(text(f.feed('z<SEND x>s</SEND>')), `${ESC}[4ms${ESC}[24m`, 'and is a mode switch once complete');
assert.equal(text(f.feed(`b${ESC}[3`)), 'b');
assert.equal(text(f.feed('1mc')), `${ESC}[31mc`, 'a split SGR is reassembled, not lost'); ok();
assert.equal(text(f.feed('&am')), ''); assert.equal(text(f.feed('p; ok')), '& ok'); ok();
assert.equal(text(f.feed(`${ESC}[1z<SEND href="say a > b">gt in quotes</SEND>`)), `${ESC}[4mgt in quotes${ESC}[24m`, 'a > inside quotes does not end the tag'); ok();
assert.equal(text(f.feed('x <i\r\nnot a tag')), 'x <i\r\nnot a tag', 'a < with no > before the line ends is text'); ok();
assert.equal(text(f.feed('tail <b')), 'tail '); assert.equal(text(f.flush()), '<b', 'flush returns what was held back'); ok();

/* ---------- ANSI colour and <I> on one line, through the real parser ---------- */
f = live();
const parser = new AnsiParser();
const toks = parser.feed(text(f.feed(`${ESC}[32mGreen with <I>italics</I> inside${ESC}[0m.\r\n`)));
const spans = toks.filter((t) => t.type === 'text').map((t) => t.span);
assert.deepEqual(spans.map((s) => [s.text, s.style.fg, s.style.italic]), [['Green with ', '2', false], ['italics', '2', true], [' inside', '2', false], ['.', null, false]]);
assert.equal(toks[toks.length - 1].type, 'newline'); ok();
const toks2 = parser.feed(text(f.feed('You say, "<I>test</I>"\r\n')));
assert.deepEqual(toks2.filter((t) => t.type === 'text').map((t) => [t.span.text, t.span.style.italic]), [['You say, "', false], ['test', true], ['"', false]]); ok();

/* ---------- parseArgs ---------- */
assert.deepEqual(parseArgs('href="look sign" hint=\'Look\' prompt'), { named: { href: 'look sign', hint: 'Look' }, positional: ['prompt'] });
assert.deepEqual(parseArgs('#ff8700 #303030'), { named: {}, positional: ['#ff8700', '#303030'] });
assert.deepEqual(parseArgs('"Times New Roman" size=3'), { named: { size: '3' }, positional: ['Times New Roman'] }); ok();

/* ---------- telnet negotiation ---------- */
function fakeSession(mxp) {
  const t = new TelnetSession({ host: 'x', port: 1, mxp });
  const written = [];
  // Stand in for the socket: capture what the engine writes back.
  t.sock = { write: (b) => written.push([...b]), destroyed: false };
  const infos = [];
  t.on('info', (m) => infos.push(m));
  let mxpEvents = 0;
  t.on('mxp', () => mxpEvents++);
  return { t, written, infos, mxpEvents: () => mxpEvents };
}
let s = fakeSession(true);
s.t.parse(Buffer.from([IAC, DO, OPT.MXP]));
assert.deepEqual(s.written, [[IAC, WILL, OPT.MXP]], 'IAC DO MXP is answered WILL');
assert.equal(s.mxpEvents(), 1);
assert.deepEqual(s.infos, ['Server asked for MXP (91): enabled']); ok();
s = fakeSession(true);
s.t.parse(Buffer.from([IAC, WILL, OPT.MXP, IAC, WILL, OPT.MXP]));
assert.deepEqual(s.written, [[IAC, DO, OPT.MXP], [IAC, DO, OPT.MXP]], 'IAC WILL MXP is answered DO');
assert.equal(s.mxpEvents(), 1, 'mxp fires once'); assert.equal(s.infos.length, 1, 'one note per option'); ok();
s = fakeSession(false);
s.t.parse(Buffer.from([IAC, DO, OPT.MXP, IAC, WILL, 93, IAC, DO, 70]));
assert.deepEqual(s.written, [[IAC, WONT, OPT.MXP], [IAC, DONT, 93], [IAC, WONT, 70]], 'off: MXP declined; unknown options refused');
assert.equal(s.mxpEvents(), 0);
assert.deepEqual(s.infos, ['Server asked for MXP (91): declined (MXP formatting is off for this world)', 'Server offered ZMP (93): not supported', 'Server asked for MSSP (70): not supported']); ok();
s = fakeSession(true);
s.t.parse(Buffer.from([IAC, WILL, OPT.ECHO, IAC, WONT, OPT.ECHO, IAC, WILL, OPT.ECHO]));
assert.deepEqual(s.infos, [], 'ECHO flips on every password prompt and is not reported'); ok();

console.log(`mxp: all ${n} groups passed`);
