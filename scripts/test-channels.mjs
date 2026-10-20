// Unit tests for channel tabs: routing (src/lib/channels.ts) and the World normalisation
// that lets old worlds.json files load without channelTabs (shared/types.ts).
// Run: node scripts/test-channels.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/channels.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/channels-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['shared/types.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/types-test.mjs', logLevel: 'silent' });
const C = await import(pathToFileURL('dist-electron/channels-test.mjs').href);
const T = await import(pathToFileURL('dist-electron/types-test.mjs').href);

let n = 0;
const ok = () => { n++; };
let ids = 0;
const uid = () => `id-${++ids}`;
const trig = (p) => ({ id: 't', name: '', pattern: '', regex: false, enabled: true, group: '', ignoreCase: false, send: '', sendTo: 'world', highlight: null, highlightLine: false, gag: false, oneShot: false, ...p });
const pat = (pattern, mode = 'capture', ignoreCase = false) => ({ id: uid(), pattern, ignoreCase, mode });
const tab = (name, patterns, extra = {}) => ({ id: uid(), name, enabled: true, keepInMain: false, notify: 'badge', commandPrefix: '', patterns, ...extra });

/* ---------- the Haven preset ---------- */
const haven = C.havenChannelTab(uid);
assert.equal(haven.name, C.HAVEN_TAB_NAME);
assert.equal(haven.patterns.length, 6);
assert.equal(new Set(haven.patterns.map((p) => p.id)).size, 6, 'every pattern gets its own id');
assert.equal(haven.keepInMain, false); assert.equal(haven.notify, 'badge');
assert.equal(haven.commandPrefix, '', 'the preset carries no command prefix (the old setup had none to copy)'); ok();
assert.equal(C.hasHavenPreset([haven]), true);
assert.equal(C.hasHavenPreset([tab('x', [pat('^\\[OOC\\] ')])]), false, 'a partial copy does not count as the preset'); ok();

/* ---------- capture ---------- */
let r = C.routeLine([haven], '[OOC] Juliet says, "anyone about?"');
assert.equal(r.action, 'capture'); assert.equal(r.tab, haven); assert.equal(r.pattern.pattern, '^\\[OOC\\] ');
assert.equal(r.showInMain, false, 'captured lines leave main by default'); assert.equal(r.showInTab, true); ok();
for (const ch of ['Guide', 'Newbie', 'HeyThere']) {
  r = C.routeLine([haven], `[${ch}] Someone: hello`);
  assert.equal(r.action, 'capture', `${ch} is captured`); ok();
}
r = C.routeLine([haven], 'Juliet smiles and says, "[OOC] is not at the start here."');
assert.equal(r.action, 'main', 'anchored pattern does not match mid-line'); assert.equal(r.showInMain, true); assert.equal(r.tab, null); ok();
r = C.routeLine([haven], 'The courtyard is quiet tonight.');
assert.equal(r.action, 'main'); assert.equal(r.showInTab, false); ok();
r = C.routeLine([haven], '[ooc] lower case');
assert.equal(r.action, 'main', 'case-sensitive unless ignoreCase'); ok();
r = C.routeLine([tab('t', [pat('^\\[ooc\\] ', 'capture', true)])], '[OOC] shout');
assert.equal(r.action, 'capture', 'ignoreCase applies'); ok();

/* ---------- silence ---------- */
r = C.routeLine([haven], '[AFK]');
assert.equal(r.action, 'silence'); assert.equal(r.tab, haven); assert.equal(r.showInMain, false); assert.equal(r.showInTab, false); ok();
r = C.routeLine([haven], '[AFK]   ');
assert.equal(r.action, 'silence', 'trailing whitespace still silenced'); ok();
r = C.routeLine([haven], '[AFK] Juliet is away from keyboard.');
assert.equal(r.action, 'main', 'an [AFK] line with text on it is not the bare marker'); ok();

/* ---------- keepInMain ---------- */
const copyTab = tab('IC chat', [pat('^\\[Chat\\] ')], { keepInMain: true });
r = C.routeLine([copyTab], '[Chat] Bob: hi');
assert.equal(r.action, 'capture'); assert.equal(r.showInMain, true, 'keepInMain copies the line'); assert.equal(r.showInTab, true); ok();
r = C.routeLine([tab('s', [pat('^\\[Chat\\] ', 'silence')], { keepInMain: true })], '[Chat] Bob: hi');
assert.equal(r.action, 'silence'); assert.equal(r.showInMain, false, 'silence ignores keepInMain'); ok();

/* ---------- ordering: first match across tabs in tab order, patterns in order ---------- */
const a = tab('A', [pat('^\\[OOC\\] ')]);
const b = tab('B', [pat('OOC')]);
assert.equal(C.routeLine([a, b], '[OOC] hi').tab.name, 'A'); ok();
assert.equal(C.routeLine([b, a], '[OOC] hi').tab.name, 'B', 'swapping tab order swaps the winner'); ok();
assert.equal(C.routeLine([a, b], 'Someone whispers OOC-ish things').tab.name, 'B', 'falls through to the next tab'); ok();
const mixed = tab('M', [pat('^\\[OOC\\] bot', 'silence'), pat('^\\[OOC\\] ')]);
assert.equal(C.routeLine([mixed], '[OOC] bot: spam').action, 'silence', 'earlier silence beats later capture in the same tab'); ok();
assert.equal(C.routeLine([mixed], '[OOC] Juliet: hi').action, 'capture'); ok();
const reversed = tab('M', [pat('^\\[OOC\\] '), pat('^\\[OOC\\] bot', 'silence')]);
assert.equal(C.routeLine([reversed], '[OOC] bot: spam').action, 'capture', 'pattern order within a tab matters'); ok();

/* ---------- disabled tabs, empty and invalid patterns ---------- */
r = C.routeLine([tab('off', [pat('^\\[OOC\\] ')], { enabled: false }), b], '[OOC] hi');
assert.equal(r.tab.name, 'B', 'disabled tabs are skipped'); ok();
r = C.routeLine([tab('bad', [pat('(unclosed'), pat('')]), a], '[OOC] hi');
assert.equal(r.tab.name, 'A', 'invalid and empty patterns never match'); ok();
assert.match(C.channelPatternError('(unclosed'), /Unterminated|group/i);
assert.equal(C.channelPatternError(''), 'Pattern is empty');
assert.equal(C.channelPatternError('^\\[OOC\\] '), null); ok();
assert.equal(C.routeLine([], 'anything').action, 'main'); ok();

/* ---------- triggers run first: a gagged line never reaches a tab ---------- */
const gag = trig({ pattern: 'bot:', gag: true });
let c = C.classifyLine([gag], [haven], '[OOC] bot: spam spam');
assert.equal(c.triggers.gag, true); assert.equal(c.route, null, 'gagged: no route at all'); ok();
assert.equal(C.logPrefix(c.route), '', 'a gagged line logs without a tab prefix'); ok();
c = C.classifyLine([gag], [haven], '[OOC] Juliet: hello');
assert.equal(c.triggers.gag, false); assert.equal(c.route.action, 'capture'); assert.equal(c.route.tab, haven); ok();
// A non-gag trigger (highlight) and a capture both apply to the same line.
c = C.classifyLine([trig({ pattern: 'Juliet', regex: true, highlight: '11' })], [haven], '[OOC] Juliet: hello');
assert.equal(c.triggers.highlights.length, 1); assert.equal(c.route.action, 'capture'); ok();
// A gag trigger that is disabled does not gag.
c = C.classifyLine([{ ...gag, enabled: false }], [haven], '[OOC] bot: spam');
assert.equal(c.route.action, 'capture'); ok();
// With no tabs the route is main (and triggers still ran).
c = C.classifyLine([trig({ pattern: 'hello', send: 'wave' })], [], 'hello there');
assert.equal(c.route.action, 'main'); assert.equal(c.triggers.outgoing.length, 1); ok();

/* ---------- log prefix ---------- */
assert.equal(C.logPrefix(C.routeLine([haven], '[OOC] hi')), `[${C.HAVEN_TAB_NAME}] `); ok();
assert.equal(C.logPrefix(C.routeLine([haven], '[AFK]')), '', 'silenced lines log as they were'); ok();
assert.equal(C.logPrefix(C.routeLine([haven], 'plain')), ''); ok();
assert.equal(C.logPrefix(null), ''); ok();

/* ---------- command prefix: what the input bar puts in front of a typed command ---------- */
const ooc = tab('OOC', [pat('^\\[OOC\\] ')], { commandPrefix: 'ooc ' });
const plainTab = tab('Guide', [pat('^\\[Guide\\] ')]);
assert.equal(C.PREFIX_BYPASS, '\\'); ok();
// Which prefix applies for a view.
assert.equal(C.activePrefix([ooc, plainTab], ooc.id), 'ooc '); ok();
assert.equal(C.activePrefix([ooc, plainTab], 'main'), '', 'Main has no prefix'); ok();
assert.equal(C.activePrefix([ooc, plainTab], plainTab.id), '', 'a tab without a prefix has none'); ok();
assert.equal(C.activePrefix([{ ...ooc, enabled: false }], ooc.id), '', 'a disabled tab cannot be the view, so no prefix'); ok();
assert.equal(C.activePrefix([ooc], 'no-such-tab'), ''); ok();
assert.equal(C.activePrefix([], ooc.id), ''); ok();
// Applied.
let p = C.applyCommandPrefix('ooc ', 'hello there');
assert.deepEqual(p, { text: 'ooc hello there', applied: true, bypassed: false }); ok();
p = C.applyCommandPrefix('ooc ', '  spaced');
assert.equal(p.text, 'ooc   spaced', 'typed text is not trimmed'); ok();
p = C.applyCommandPrefix('ooc ', 'line one\nline two');
assert.equal(p.text, 'ooc line one\nline two', 'a multi-line entry is prefixed once, at the start'); ok();
// Bypassed with a leading backslash: the backslash goes, the prefix is skipped.
p = C.applyCommandPrefix('ooc ', '\\look');
assert.deepEqual(p, { text: 'look', applied: false, bypassed: true }); ok();
p = C.applyCommandPrefix('ooc ', '\\');
assert.deepEqual(p, { text: '', applied: false, bypassed: true }, 'a lone backslash sends a blank line'); ok();
p = C.applyCommandPrefix('ooc ', 'not \\ at the start');
assert.equal(p.text, 'ooc not \\ at the start', 'only a leading backslash bypasses'); ok();
// A blank line is sent blank rather than as "ooc ".
p = C.applyCommandPrefix('ooc ', '');
assert.deepEqual(p, { text: '', applied: false, bypassed: false }); ok();
p = C.applyCommandPrefix('ooc ', '   ');
assert.equal(p.text, '   '); assert.equal(p.applied, false); ok();
// Empty prefix (Main, or a tab without one): everything passes through untouched, backslash included.
for (const typed of ['look', '\\look', '', '\\', 'ooc hi']) {
  p = C.applyCommandPrefix('', typed);
  assert.deepEqual(p, { text: typed, applied: false, bypassed: false }, `no prefix leaves "${typed}" alone`); ok();
}
// End to end: the view decides, Main untouched, the OOC tab prefixed, bypass works there.
const prefixFor = (view, typed) => C.applyCommandPrefix(C.activePrefix([ooc, plainTab], view), typed).text;
assert.equal(prefixFor('main', 'hello'), 'hello'); ok();
assert.equal(prefixFor('main', '\\hello'), '\\hello', 'Main keeps a leading backslash'); ok();
assert.equal(prefixFor(ooc.id, 'hello'), 'ooc hello'); ok();
assert.equal(prefixFor(ooc.id, '\\hello'), 'hello'); ok();
assert.equal(prefixFor(plainTab.id, 'hello'), 'hello'); ok();
// The prefix is text, not a pattern: whatever it is goes in front verbatim.
assert.equal(C.applyCommandPrefix('@emit ', 'waves.').text, '@emit waves.'); ok();
assert.equal(C.applyCommandPrefix('ooc', 'hi').text, 'oochi', 'no space is added for you'); ok();

/* ---------- normalisation: old worlds.json files load ---------- */
const old = T.normalizeWorld({ id: 'w', name: 'Old', host: 'h', port: 1, triggers: [], aliases: [], timers: [] });
assert.deepEqual(old.channelTabs, [], 'a world saved before channel tabs gets an empty list'); ok();
const w = T.normalizeWorld({ id: 'w', channelTabs: [{ id: 'c1', name: 'OOC', patterns: [{ id: 'p1', pattern: '^x' }, { id: 'p2', pattern: '^y', mode: 'silence', ignoreCase: true }] }] });
assert.equal(w.channelTabs.length, 1);
const ct = w.channelTabs[0];
assert.equal(ct.enabled, true); assert.equal(ct.keepInMain, false); assert.equal(ct.notify, 'badge');
assert.equal(ct.commandPrefix, '', 'a tab saved before command prefixes gets an empty one');
assert.deepEqual(ct.patterns[0], { id: 'p1', pattern: '^x', ignoreCase: false, mode: 'capture' });
assert.deepEqual(ct.patterns[1], { id: 'p2', pattern: '^y', ignoreCase: true, mode: 'silence' }); ok();
assert.equal(T.normalizeChannelTab({ id: 'c', notify: 'loud' }).notify, 'badge', 'unknown notify falls back to badge'); ok();
assert.equal(T.normalizeChannelPattern({ id: 'p', mode: 'drop' }).mode, 'capture', 'unknown mode falls back to capture'); ok();
assert.deepEqual(T.normalizeChannelTab({ id: 'c' }).patterns, []); ok();
assert.equal(T.normalizeChannelTab({ id: 'c', commandPrefix: 'ooc ' }).commandPrefix, 'ooc ', 'a saved prefix survives, trailing space included'); ok();
assert.equal(T.normalizeChannelTab({ id: 'c', commandPrefix: 42 }).commandPrefix, '', 'a non-string prefix falls back to empty'); ok();
assert.equal(T.normalizeChannelTab({ id: 'c', commandPrefix: null }).commandPrefix, ''); ok();
// Routing works on a normalised tab straight from disk.
assert.equal(C.routeLine(w.channelTabs, 'x marks').action, 'capture');
assert.equal(C.routeLine(w.channelTabs, 'Y not').action, 'silence'); ok();


// Command-triggered capture (Help tab)
{
  const help = C.helpChannelTab(uid);
  const tabs = [C.havenChannelTab(uid), help];
  assert.equal(C.commandCaptureTab(tabs, 'help emote')?.id, help.id, 'help command starts capture');
  assert.equal(C.commandCaptureTab(tabs, 'HELP')?.id, help.id, 'case-insensitive');
  assert.equal(C.commandCaptureTab(tabs, 'helpme'), null, 'word boundary respected');
  assert.equal(C.commandCaptureTab(tabs, 'say hello'), null, 'other commands do not capture');
  assert.equal(C.commandCaptureTab([{ ...help, enabled: false }], 'help'), null, 'disabled tab ignored');
  assert.equal(C.commandCaptureTab([{ ...help, captureCommands: '(' }], 'help'), null, 'bad regex ignored');
  assert.ok(C.hasHelpPreset(tabs) && !C.hasHelpPreset([tabs[0]]));
  n += 7;
}
// OOCly tells captured both directions by the single preset pattern
{
  const tab = C.havenChannelTab(uid);
  const line1 = "Mirudus tells you OOCly 'I get it.'";
  const line2 = "You tell Mirudus OOCly 'Agree.'";
  const r1 = C.routeLine([tab], line1);
  const r2 = C.routeLine([tab], line2);
  assert.equal(r1.action, 'capture', 'incoming OOCly tell captured');
  assert.equal(r2.action, 'capture', 'outgoing OOCly tell captured');
  assert.equal(C.routeLine([tab], 'She walks away OOCly unbothered.').action, 'main', 'a bare "OOCly" in prose is not captured');
  n += 3;
}
console.log(`test-channels: ${n} checks passed`);
