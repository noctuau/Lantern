// Unit tests for find-in-output matching (src/lib/search.ts): literal vs regex, case folding,
// multiple hits per line, ordering across lines, empty/invalid queries, zero-width guard.
// Run: node scripts/test-search.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['src/lib/search.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/search-test.mjs', logLevel: 'silent' });
const { findMatches, queryIsValid, escapeRegExp, compileQuery } = await import(pathToFileURL('dist-electron/search-test.mjs').href);

let n = 0;
const ok = (msg) => { n++; if (process.env.V) console.log('ok', msg); };

// Build the {id, text} shape OutputPane passes, from a list of strings.
const buf = (...strings) => strings.map((text, i) => ({ id: i + 1, text }));
// Flatten matches to compact [lineId, start, end] tuples for easy asserting.
const hits = (lines, q, opts = {}) => findMatches(lines, q, { regex: false, caseSensitive: false, ...opts }).map((m) => [m.lineId, m.start, m.end]);

/* ---------- plain substring ---------- */
{
  const lines = buf('the orc hits you', 'you hit the orc');
  assert.deepEqual(hits(lines, 'orc'), [[1, 4, 7], [2, 12, 15]]);
  ok('literal substring, one hit per line, in reading order');
}
{
  assert.deepEqual(hits(buf('orc orc orc'), 'orc'), [[1, 0, 3], [1, 4, 7], [1, 8, 11]]);
  ok('multiple hits on one line, left to right');
}
{
  // Regex metacharacters are literal in plain mode.
  assert.deepEqual(hits(buf('cost is $5 (each)'), '$5'), [[1, 8, 10]]);
  assert.deepEqual(hits(buf('a.b aXb'), 'a.b'), [[1, 0, 3]]);
  ok('plain mode treats . and $ literally');
}

/* ---------- case folding ---------- */
{
  assert.equal(hits(buf('Orc ORC orc'), 'orc').length, 3);
  ok('case-insensitive by default');
  assert.deepEqual(hits(buf('Orc ORC orc'), 'orc', { caseSensitive: true }), [[1, 8, 11]]);
  ok('match case finds only the exact casing');
}

/* ---------- regex ---------- */
{
  assert.deepEqual(hits(buf('hp 40/50 mana 10/20'), '\\d+/\\d+', { regex: true }), [[1, 3, 8], [1, 14, 19]]);
  ok('regex finds both number pairs');
}
{
  assert.deepEqual(hits(buf('Liesel whispers'), '^\\w+', { regex: true }), [[1, 0, 6]]);
  ok('regex anchors work against the whole line');
}
{
  // Invalid regex: no throw, no matches, and queryIsValid reports it.
  assert.deepEqual(hits(buf('abc'), '(', { regex: true }), []);
  assert.equal(queryIsValid('(', { regex: true, caseSensitive: false }), false);
  assert.equal(queryIsValid('(', { regex: false, caseSensitive: false }), true, 'an unclosed paren is fine as a literal');
  ok('invalid regex: empty result, flagged by queryIsValid');
}

/* ---------- edge cases ---------- */
{
  assert.deepEqual(hits(buf('anything'), ''), [], 'empty query matches nothing');
  assert.deepEqual(hits([{ id: 9, text: '' }], 'x'), [], 'empty line is skipped');
  ok('empty query and empty lines');
}
{
  // Zero-width-capable regex must terminate and record only the real (non-empty) hits.
  const r = hits(buf('xaax'), 'a*', { regex: true });
  assert.deepEqual(r, [[1, 1, 3]]);
  ok('zero-width match guard: a* finds "aa" only, no hang');
}
{
  assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c');
  assert.equal(compileQuery('', { regex: false, caseSensitive: false }), null);
  assert.equal(compileQuery('x', { regex: false, caseSensitive: false }).flags, 'gi');
  assert.equal(compileQuery('x', { regex: false, caseSensitive: true }).flags, 'g');
  ok('escapeRegExp and compileQuery flags');
}

console.log(`\n${n} assertions passed.`);
