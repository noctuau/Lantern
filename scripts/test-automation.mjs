// Unit tests for the automation engine and the .MCL trigger/alias/timer import.
// Run: node scripts/test-automation.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/automation.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/automation-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['electron/mcl.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/mcl-test.mjs', logLevel: 'silent' });
const A = await import(pathToFileURL('dist-electron/automation-test.mjs').href);
const M = await import(pathToFileURL('dist-electron/mcl-test.mjs').href);

const trig = (p) => ({ id: 't', name: '', pattern: '', regex: false, enabled: true, group: '', ignoreCase: false, send: '', sendTo: 'world', highlight: null, highlightLine: false, gag: false, oneShot: false, ...p });
const alias = (p) => ({ id: 'a', name: '', pattern: '', regex: false, enabled: true, group: '', ignoreCase: true, send: '', sendTo: 'world', ...p });
const plainStyle = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false };
let n = 0;
const ok = (msg) => { n++; };

/* ---------- triggers: plain ---------- */
let r = A.runTriggers([trig({ pattern: 'tells you', send: 'say hi' })], 'Bob tells you, "hello"');
assert.equal(r.fired.length, 1); assert.deepEqual(r.outgoing, [{ text: 'say hi', sendTo: 'world' }]); ok();
r = A.runTriggers([trig({ pattern: 'tells you' })], 'Bob TELLS YOU');
assert.equal(r.fired.length, 0, 'plain match is case-sensitive unless ignoreCase'); ok();
r = A.runTriggers([trig({ pattern: 'tells you', ignoreCase: true })], 'Bob TELLS YOU');
assert.equal(r.fired.length, 1); ok();
// Wildcards capture and must span the whole line
r = A.runTriggers([trig({ pattern: '* tells you, "*"', send: 'reply %1 I heard: %2' })], 'Bob tells you, "hello there"');
assert.deepEqual(r.outgoing.map((o) => o.text), ['reply Bob I heard: hello there']); ok();
r = A.runTriggers([trig({ pattern: '* tells you', send: 'x' })], 'Bob tells you something');
assert.equal(r.fired.length, 0, 'wildcard pattern is anchored to the whole line'); ok();

/* ---------- triggers: regex ---------- */
r = A.runTriggers([trig({ pattern: '^(\\w+) pages: (.*)$', regex: true, send: 'page %1=got it: %2\nthink %0' })], 'Alice pages: are you there?');
assert.deepEqual(r.outgoing.map((o) => o.text), ['page Alice=got it: are you there?', 'think Alice pages: are you there?']); ok();
assert.equal(A.substitute('100%% sure %1', ['', 'x']), '100% sure x'); ok();
assert.equal(A.substitute('%9 end', ['a']), ' end', 'missing captures become empty'); ok();
r = A.runTriggers([trig({ pattern: '(unclosed', regex: true, send: 'x' })], '(unclosed');
assert.equal(r.fired.length, 0, 'invalid regex never fires'); ok();
assert.match(A.patternError('(unclosed', true), /Unterminated|group/i); ok();
assert.equal(A.patternError('(plain', false), null); ok();

/* ---------- gag, one-shot, disabled, send to output ---------- */
r = A.runTriggers([trig({ pattern: 'spam', gag: true })], 'some spam here');
assert.equal(r.gag, true); ok();
r = A.runTriggers([trig({ pattern: 'spam', gag: true, enabled: false })], 'some spam here');
assert.equal(r.fired.length, 0); assert.equal(r.gag, false); ok();
r = A.runTriggers([trig({ pattern: 'thy name', regex: true, ignoreCase: true, oneShot: true, send: 'Fired on "%0"', sendTo: 'output' })], 'What be THY NAME?');
assert.deepEqual(r.outgoing, [{ text: 'Fired on "THY NAME"', sendTo: 'output' }]); assert.equal(r.fired[0].oneShot, true); ok();

/* ---------- highlights ---------- */
r = A.runTriggers([trig({ pattern: 'Rose', regex: true, highlight: '11' })], 'Rose smiles at Rose.');
assert.deepEqual(r.highlights, [{ start: 0, end: 4, colour: '11' }, { start: 15, end: 19, colour: '11' }], 'regex highlight repeats on the line'); ok();
let spans = A.applyHighlights([{ text: 'Rose smiles at Rose.', style: plainStyle }], r.highlights);
assert.deepEqual(spans.map((s) => [s.text, s.style.fg]), [['Rose', '11'], [' smiles at ', null], ['Rose', '11'], ['.', null]]); ok();
// Whole-line highlight across pre-existing coloured spans keeps the span split but recolours all of it
r = A.runTriggers([trig({ pattern: 'courtyard', highlight: '#ff8040', highlightLine: true })], 'At the courtyard benches');
spans = A.applyHighlights([{ text: 'At the ', style: { ...plainStyle, fg: '2' } }, { text: 'courtyard benches', style: plainStyle }], r.highlights);
assert.deepEqual(spans.map((s) => s.style.fg), ['#ff8040', '#ff8040']); assert.equal(spans.map((s) => s.text).join(''), 'At the courtyard benches'); ok();
// Highlight range that straddles a span boundary
spans = A.applyHighlights([{ text: 'abc', style: plainStyle }, { text: 'def', style: { ...plainStyle, bold: true } }], [{ start: 2, end: 4, colour: '1' }]);
assert.deepEqual(spans.map((s) => [s.text, s.style.fg, s.style.bold]), [['ab', null, false], ['c', '1', false], ['d', '1', false], ['ef', null, true]]); ok();
assert.deepEqual(A.applyHighlights([{ text: 'x', style: plainStyle }], []).length, 1); ok();

/* ---------- aliases ---------- */
const aliases = [
  alias({ pattern: 'gg', send: 'get %1 from bag' }),
  alias({ pattern: '^look in (.*)', regex: true, send: 'look %1' }),
  alias({ pattern: 'tp *', send: 'teleport %1' }),
  alias({ pattern: 'ooc', send: 'OOC says, %1', enabled: false }),
];
let e = A.expandAlias(aliases, 'gg sword');
assert.deepEqual(e.outgoing.map((o) => o.text), ['get sword from bag']); ok();
e = A.expandAlias(aliases, 'GG shield');
assert.deepEqual(e.outgoing.map((o) => o.text), ['get shield from bag'], 'plain alias ignores case by default'); ok();
assert.equal(A.expandAlias(aliases, 'ggg sword'), null, 'prefix must be a whole word'); ok();
assert.equal(A.expandAlias(aliases, 'gg').outgoing[0].text, 'get  from bag', 'prefix alone matches with empty %1'); ok();
e = A.expandAlias(aliases, 'look in chest');
assert.deepEqual(e.outgoing.map((o) => o.text), ['look chest']); ok();
e = A.expandAlias(aliases, 'tp home');
assert.deepEqual(e.outgoing.map((o) => o.text), ['teleport home']); ok();
assert.equal(A.expandAlias(aliases, 'ooc hi'), null, 'disabled alias is skipped'); ok();
assert.equal(A.expandAlias(aliases, 'say hi'), null); ok();

/* ---------- stacking + speedwalk ---------- */
const world = { aliases, commandStacking: true, commandStackChar: ';', speedwalk: true, speedwalkPrefix: '#' };
let x = A.expandCommand(world, 'look;gg sword;say a;;b');
assert.deepEqual(x.outgoing.map((o) => o.text), ['look', 'get sword from bag', 'say a;b']); assert.equal(x.aliasesUsed.length, 1); ok();
x = A.expandCommand(world, '#3n2e(open door)u');
assert.deepEqual(x.outgoing.map((o) => o.text), ['n', 'n', 'n', 'e', 'e', 'open door', 'u']); ok();
x = A.expandCommand(world, '#2sw');
assert.deepEqual(x.outgoing.map((o) => o.text), ['sw', 'sw']); ok();
x = A.expandCommand(world, '#hello');
assert.deepEqual(x.outgoing.map((o) => o.text), ['#hello'], 'non-speedwalk text after the prefix is sent as typed'); ok();
x = A.expandCommand({ ...world, commandStacking: false, speedwalk: false }, 'look;#3n');
assert.deepEqual(x.outgoing.map((o) => o.text), ['look;#3n'], 'both off by default'); ok();
assert.deepEqual(A.splitStacked('a;;b;c', ';'), ['a;b', 'c']); ok();

/* ---------- timers ---------- */
const at = new Date(2026, 9, 20, 10, 0, 0);
assert.equal(A.msUntil('10:30', at), 30 * 60 * 1000); ok();
assert.equal(A.msUntil('09:00', at), 23 * 60 * 60 * 1000, 'earlier today → tomorrow'); ok();
assert.equal(A.msUntil('25:00', at), null); ok();
assert.equal(A.describeTimer({ everySeconds: 300, at: null }), 'every 5m'); ok();
assert.equal(A.describeTimer({ everySeconds: 0, at: '04:00' }), 'daily at 04:00'); ok();
{
  const fired = [];
  const sched = new A.TimerScheduler((t) => fired.push(t.id));
  sched.start([
    { id: 'fast', enabled: true, everySeconds: 1, at: null, oneShot: false },
    { id: 'off', enabled: false, everySeconds: 1, at: null, oneShot: false },
    { id: 'once', enabled: true, everySeconds: 1, at: null, oneShot: true },
  ]);
  assert.equal(sched.running, 2);
  await new Promise((res) => setTimeout(res, 2300));
  sched.stop();
  assert.equal(fired.filter((id) => id === 'fast').length, 2, 'interval timer fired twice in 2.3s');
  assert.equal(fired.filter((id) => id === 'once').length, 1, 'one-shot fired once');
  assert.equal(fired.includes('off'), false);
  assert.equal(sched.running, 0);
  ok();
}

/* ---------- .MCL import ---------- */
const mcl = `<?xml version="1.0" encoding="iso-8859-1"?>
<!DOCTYPE muclient>
<muclient>
<world
   name="Haven"
   site="haven.example.org"
   port="4242"
   enable_command_stack="y"
   command_stack_character=";"
   speed_walk_prefix="#"
   connect_text="connect Rose hunter2&#10;"
   log_output="y"
  >
<triggers>
  <trigger
   custom_colour="17"
   enabled="y"
   ignore_case="y"
   keep_evaluating="y"
   match="Rose|Rosie"
   name="me"
   group="Highlighted Words"
   other_text_colour="#FF8040"
   regexp="y"
   repeat="y"
   sequence="100"
  >
  </trigger>
  <trigger
   enabled="y"
   match="* pages: *"
   omit_from_output="y"
   one_shot="y"
   sequence="50"
   send_to="2"
  >
  <send>%1 paged &quot;%2&quot;</send>
  </trigger>
  <trigger enabled="y" match="^You are hungry" regexp="y" send_to="12" script="on_hungry" sequence="100">
  <send>Send("eat bread")</send>
  </trigger>
  <trigger enabled="n" match="" regexp="n" sequence="100"></trigger>
</triggers>
<aliases>
  <alias
   match="^look in (.*)"
   enabled="y"
   regexp="y"
   sequence="100"
  >
  <send>look %1</send>
  </alias>
</aliases>
<timers>
  <timer enabled="y" minute="5" second="0.00" offset_second="0.00" >
  <send>idle</send>

  </timer>
  <timer enabled="y" hour="18" second="0.00" at_time="y" send_to="12" >
  <send>Note("Witching hour soon");</send>
  </timer>
</timers>
</muclient>`;
const w = M.importMcl(mcl);
assert.equal(w.name, 'Haven'); assert.equal(w.host, 'haven.example.org'); assert.equal(w.port, 4242);
assert.equal(w.autoConnect, 'connect Rose hunter2\n');
assert.equal(w.commandStacking, true); assert.equal(w.commandStackChar, ';'); assert.equal(w.speedwalk, false); assert.equal(w.speedwalkPrefix, '#'); ok();

assert.equal(w.triggers.length, 3, 'empty-pattern trigger dropped');
// Sorted by sequence: the pager (50) before the highlight (100)
const [pager, me, hungry] = w.triggers;
assert.equal(pager.pattern, '* pages: *'); assert.equal(pager.regex, false); assert.equal(pager.gag, true); assert.equal(pager.oneShot, true);
assert.equal(pager.sendTo, 'output'); assert.equal(pager.send, '%1 paged "%2"'); assert.equal(pager.highlightLine, true); ok();
assert.equal(me.name, 'me'); assert.equal(me.regex, true); assert.equal(me.ignoreCase, true); assert.equal(me.group, 'Highlighted Words');
assert.equal(me.highlight, '#FF8040'); assert.equal(me.highlightLine, false); assert.equal(me.send, ''); ok();
assert.equal(hungry.script, 'on_hungry'); assert.equal(hungry.scriptBody, 'Send("eat bread")'); assert.equal(hungry.send, ''); ok();
// The imported triggers actually work
r = A.runTriggers(w.triggers, 'Bob pages: hi there');
assert.equal(r.gag, true); assert.deepEqual(r.outgoing, [{ text: 'Bob paged "hi there"', sendTo: 'output' }]); ok();
r = A.runTriggers(w.triggers, 'rosie and Rose wave.');
assert.equal(r.highlights.length, 2); assert.equal(r.highlights[0].colour, '#FF8040'); ok();

assert.equal(w.aliases.length, 1);
assert.equal(w.aliases[0].pattern, '^look in (.*)'); assert.equal(w.aliases[0].regex, true); assert.equal(w.aliases[0].send, 'look %1');
assert.deepEqual(A.expandAlias(w.aliases, 'look in bag').outgoing.map((o) => o.text), ['look bag']); ok();

assert.equal(w.timers.length, 2);
assert.equal(w.timers[0].everySeconds, 300); assert.equal(w.timers[0].at, null); assert.equal(w.timers[0].send, 'idle'); assert.equal(w.timers[0].enabled, true);
assert.equal(w.timers[1].at, '18:00'); assert.equal(w.timers[1].everySeconds, 0); assert.equal(w.timers[1].scriptBody, 'Note("Witching hour soon");'); ok();

// custom_colour 1..16 maps onto the ANSI palette
const t16 = M.importMclTriggers('<trigger custom_colour="3" enabled="y" match="x" regexp="y"></trigger>');
assert.equal(t16[0].highlight, '12'); ok();

/* ---------- cleanTyped: smart punctuation and invisibles → what a MUD expects ---------- */
const C = A.cleanTyped;
assert.equal(C('say hello'), 'say hello', 'plain ASCII is returned as is'); ok();
assert.equal(C(''), ''); ok();
assert.equal(C('say \u201CHello,\u201D she said. \u2018Hi.\u2019'), 'say "Hello," she said. \'Hi.\'', 'curly quotes become straight'); ok();
assert.equal(C('pose doesn\u2019t'), "pose doesn't", 'curly apostrophe'); ok();
assert.equal(C('\u00ABquoted\u00BB \u2039single\u203A'), '"quoted" \'single\'', 'guillemets'); ok();
assert.equal(C('5\u203210\u2033'), '5\'10"', 'primes'); ok();
assert.equal(C('pose waves \u2014 slowly \u2014 then stops'), 'pose waves -- slowly -- then stops', 'em dash becomes --'); ok();
assert.equal(C('1\u20132 and non\u2011breaking and \u2212x'), '1-2 and non-breaking and -x', 'en dash, non-breaking hyphen and minus become -'); ok();
assert.equal(C('say well\u2026'), 'say well...', 'ellipsis'); ok();
assert.equal(C('1\u20442 \u2022 point'), '1/2 * point', 'fraction slash and bullet'); ok();
assert.equal(C('say a\u00A0b\u2003c\u202Fd\u3000e'), 'say a b c d e', 'non-breaking, em, narrow and ideographic spaces become a space'); ok();
assert.equal(C('say a\u200Bb\u200Dc\uFEFFd\u00ADe'), 'say abcde', 'zero-width characters, BOM and soft hyphen are dropped'); ok();
assert.equal(C('line one\r\nline two\rline three\u2028four'), 'line one\nline two\nline three\nfour', 'Windows and Unicode line breaks become \\n'); ok();
assert.equal(C('a\u0007b\u001Bc\td\u0085e\u009Ff'), 'abc\td\nef', 'control codes are dropped, tab kept, NEL is a line break'); ok();
assert.equal(C('\uFF53\uFF41\uFF59\u3000\uFF28\uFF49\uFF01'), 'say Hi!', 'full-width ASCII from a CJK keyboard'); ok();
assert.equal(C('say caf\u00E9 na\u00EFve \u00FC'), 'say caf\u00E9 na\u00EFve \u00FC', 'accented letters are left alone'); ok();
assert.equal(C('say cafe\u0301'), 'say caf\u00E9', 'a combining accent is composed into one letter (NFC)'); ok();
assert.equal(C('say \u{1F600} \u2665'), 'say \u{1F600} \u2665', 'emoji and symbols are left alone'); ok();
assert.equal(C('look;inv #3n \\ooc'), 'look;inv #3n \\ooc', 'stacking, speedwalk and prefix-bypass characters are untouched'); ok();
assert.equal(C('say \u201C\u2014\u2026\u201D'), 'say "--..."', 'several swaps in one string'); ok();

/* ---------- applyMarkup: *italic*, **bold**, __underline__ in chat commands ---------- */
const mk = (p = {}) => ({ enabled: true, commands: 'say emote pose ooc : "', boldOn: '`1', boldOff: '`4', italicOn: '`2', italicOff: '`5', underlineOn: '`3', underlineOff: '`6', ...p });
const MU = A.applyMarkup;
assert.equal(MU(mk({ enabled: false }), 'say *hi*'), 'say *hi*', 'off: untouched'); ok();
assert.equal(MU(mk(), 'say *hi*'), 'say `2hi`5', 'italic'); ok();
assert.equal(MU(mk(), 'say **hi**'), 'say `1hi`4', 'bold'); ok();
assert.equal(MU(mk(), 'say __hi__'), 'say `3hi`6', 'underline'); ok();
assert.equal(MU(mk(), 'say *hi* **there** __now__'), 'say `2hi`5 `1there`4 `3now`6', 'all three in one command'); ok();
assert.equal(MU(mk(), 'emote smiles *very slowly* at **you**.'), 'emote smiles `2very slowly`5 at `1you`4.', 'spans with spaces inside'); ok();
assert.equal(MU(mk(), 'SAY *hi*'), 'SAY `2hi`5', 'verb match ignores case'); ok();
assert.equal(MU(mk(), ':waves *happily*'), ':waves `2happily`5', 'a symbol in the list matches the start'); ok();
assert.equal(MU(mk(), '"*really*?'), '"`2really`5?'); ok();
assert.equal(MU(mk(), 'look *at* things'), 'look *at* things', 'an unlisted verb is untouched'); ok();
assert.equal(MU(mk(), 'sayings *x*'), 'sayings *x*', 'the verb must be the whole first word'); ok();
assert.equal(MU(mk(), 'say 2*3*4 is 24'), 'say 2*3*4 is 24', 'asterisks glued to words are arithmetic, not emphasis'); ok();
assert.equal(MU(mk(), 'say * and ** stay'), 'say * and ** stay', 'lone stars stay'); ok();
assert.equal(MU(mk(), 'say * not this *'), 'say * not this *', 'emphasis must hug its text'); ok();
assert.equal(MU(mk(), 'say my_snake_case__name__is fine'), 'say my_snake_case__name__is fine', 'underscores inside a word stay'); ok();
assert.equal(MU(mk(), 'say \\*literal\\* and *real*'), 'say *literal* and `2real`5', 'backslash sends a literal star'); ok();
assert.equal(MU(mk(), 'say \\_\\_x\\_\\_'), 'say __x__', 'backslash sends literal underscores'); ok();
assert.equal(MU(mk(), 'say plain text'), 'say plain text', 'nothing to do'); ok();
assert.equal(MU(mk({ italicOn: '<i>', italicOff: '</i>' }), 'say *hi*'), 'say <i>hi</i>', 'codes are whatever the world says'); ok();
assert.equal(MU(mk({ commands: '' }), 'say *hi*'), 'say *hi*', 'an empty list matches nothing'); ok();
assert.equal(MU(mk(), 'ooc *hi* from the ooc tab'), 'ooc `2hi`5 from the ooc tab', 'works after a channel-tab prefix was put on'); ok();
assert.equal(A.markupApplies('say emote', 'Say hello'), true); ok();
assert.equal(A.markupApplies('say emote', 'say'), true, 'the bare verb counts'); ok();
assert.equal(A.markupApplies('say emote', 'sayhello'), false); ok();
assert.equal(A.markupApplies('s.y', 's.y hi'), true, 'odd characters in a verb are taken literally'); ok();

console.log(`automation: all ${n} assertion groups passed`);
