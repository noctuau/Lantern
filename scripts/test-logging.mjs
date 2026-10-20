// Unit test for log file name patterns and the HTML log line format.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['shared/logname.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/logname-test.mjs', logLevel: 'silent' });
await build({ entryPoints: ['src/lib/loghtml.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/loghtml-test.mjs', logLevel: 'silent' });
const { strftime, expandLogName, safeName } = await import(pathToFileURL('dist-electron/logname-test.mjs').href);
const { spansToHtml, lineHtml, LOG_HTML_HEAD } = await import(pathToFileURL('dist-electron/loghtml-test.mjs').href);

const d = new Date(2026, 9, 20, 14, 5, 9); // Tue 20 Oct 2026 14:05:09
assert.equal(strftime('%a-%d-%b-%Y', d), 'Tue-20-Oct-2026');
assert.equal(strftime('%A %B %e %y %H:%M:%S %p %j %%', d), 'Tuesday October 20 26 14:05:09 PM 293 %');
assert.equal(strftime('%q', d), '%q', 'unknown fields are left alone');

assert.equal(safeName('Haven: Juliet/Rose?'), 'Haven_ Juliet_Rose_');
assert.equal(expandLogName('', 'Haven', 'text', d), 'Haven 2026-10-20.txt', 'empty pattern uses the default');
assert.equal(expandLogName('{world}-%a', 'Haven', 'html', d), 'Haven-Tue.html', 'extension follows the format');
assert.equal(expandLogName('C:\\Logs\\Liesel\\Liesel-%a-%d-%b-%Y.txt', 'Haven', 'html', d), 'C:\\Logs\\Liesel\\Liesel-Tue-20-Oct-2026.txt', 'an explicit extension is kept');
assert.equal(expandLogName('rp/{world}/%Y/%m-%d', 'KD', 'text', d), 'rp/KD/2026/10-20.txt');

const plain = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false };
const html = spansToHtml([
  { text: '<b>&', style: plain },
  { text: 'red', style: { ...plain, fg: '1', bold: true } },
  { text: 'x', style: { ...plain, fg: '208', underline: true } },
  { text: 'y', style: { ...plain, bg: '#102030' } },
]);
assert.equal(html, '&lt;b&gt;&amp;<span class="f9" style="font-weight:600">red</span><span style="color:#ff8700;text-decoration:underline">x</span><span style="background:#102030">y</span>');
assert.equal(lineHtml('command', '', [{ text: 'look', style: plain }]), '<div class="cmd">&gt; look</div>');
assert.equal(lineHtml('output', '[OOC] ', [{ text: 'hi', style: plain }]), '<div>[OOC] hi</div>');
assert.equal(lineHtml('output', '', []), '<div>&nbsp;</div>');
assert.ok(LOG_HTML_HEAD.startsWith('<!doctype html>') && LOG_HTML_HEAD.includes('.f11{color:#f5cf6c}'));
console.log('test-logging: all assertions passed');
