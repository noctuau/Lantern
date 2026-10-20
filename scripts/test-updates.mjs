// Unit tests for the pure part of in-app updates (shared/updates.ts): version comparison,
// picking the right release asset, and reading GitHub's "latest release" JSON.
// Run: node scripts/test-updates.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

await build({ entryPoints: ['shared/updates.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/updates-test.mjs', logLevel: 'silent' });
const U = await import(pathToFileURL('dist-electron/updates-test.mjs').href);

let n = 0;
const ok = () => { n++; };

/* ---------- versions ---------- */
assert.deepEqual(U.parseVersion('v0.3.1'), [0, 3, 1]); ok();
assert.deepEqual(U.parseVersion('0.10.0'), [0, 10, 0]); ok();
assert.deepEqual(U.parseVersion('1.2.3-beta.4'), [1, 2, 3], 'a prerelease suffix is ignored'); ok();
assert.equal(U.parseVersion('latest'), null); ok();
assert.equal(U.compareVersions('0.3.1', '0.3.1'), 0); ok();
assert.equal(U.compareVersions('v0.3.1', '0.3.1'), 0, 'the v is ignored'); ok();
assert.equal(U.compareVersions('0.3.2', '0.3.1'), 1); ok();
assert.equal(U.compareVersions('0.3.1', '0.3.2'), -1); ok();
assert.equal(U.compareVersions('0.10.0', '0.9.9'), 1, 'numeric, not string, comparison'); ok();
assert.equal(U.compareVersions('1.0', '1.0.0'), 0, 'a missing part is 0'); ok();
assert.equal(U.compareVersions('1.0.1', '1.0'), 1); ok();
assert.equal(U.compareVersions('junk', '0.1'), -1, 'unparseable sorts lowest'); ok();
assert.equal(U.compareVersions('junk', 'more junk'), 0); ok();

/* ---------- assets ---------- */
const dl = (name, size = 1000) => ({ name, url: `${U.DOWNLOAD_PREFIX}v0.3.2/${name}`, size });
const assets = [dl('Lantern-0.3.2-portable.exe', 2000), dl('Lantern-0.3.2-x64.exe', 3000), dl('latest.yml', 10)];
assert.equal(U.pickAsset(assets, 'installer').name, 'Lantern-0.3.2-x64.exe'); ok();
assert.equal(U.pickAsset(assets, 'portable').name, 'Lantern-0.3.2-portable.exe'); ok();
assert.equal(U.pickAsset([dl('Lantern-0.3.2-portable.exe')], 'installer'), null, 'the portable exe never stands in for the installer'); ok();
assert.equal(U.pickAsset([dl('Lantern-0.3.2-x64.exe')], 'portable'), null); ok();
assert.equal(U.pickAsset([dl('Lantern-Setup.exe')], 'installer').name, 'Lantern-Setup.exe', 'any non-portable exe counts as the installer'); ok();
assert.equal(U.pickAsset([], 'installer'), null); ok();

/* ---------- reading the GitHub JSON (shape of the real v0.3.1 reply) ---------- */
const json = {
  tag_name: 'v0.3.2', name: 'Lantern 0.3.2', body: 'Unread pills\r\nTidy what I type', published_at: '2026-10-21T01:02:03Z',
  html_url: 'https://github.com/noctuau/Lantern/releases/tag/v0.3.2',
  assets: [
    { name: 'Lantern-0.3.2-portable.exe', browser_download_url: `${U.DOWNLOAD_PREFIX}v0.3.2/Lantern-0.3.2-portable.exe`, size: 112436846 },
    { name: 'Lantern-0.3.2-x64.exe', browser_download_url: `${U.DOWNLOAD_PREFIX}v0.3.2/Lantern-0.3.2-x64.exe`, size: 112679048 },
  ],
};
let u = U.describeRelease(json, '0.3.1', 'installer');
assert.equal(u.latest, '0.3.2'); assert.equal(u.current, '0.3.1'); assert.equal(u.newer, true);
assert.equal(u.name, 'Lantern 0.3.2'); assert.equal(u.notes, 'Unread pills\r\nTidy what I type');
assert.equal(u.publishedAt, '2026-10-21T01:02:03Z'); assert.equal(u.url, json.html_url);
assert.equal(u.flavour, 'installer'); assert.equal(u.asset.name, 'Lantern-0.3.2-x64.exe'); assert.equal(u.asset.size, 112679048); ok();
u = U.describeRelease(json, '0.3.1', 'portable');
assert.equal(u.asset.name, 'Lantern-0.3.2-portable.exe'); ok();
u = U.describeRelease(json, '0.3.2', 'installer');
assert.equal(u.newer, false, 'same version is not newer'); ok();
u = U.describeRelease(json, '0.4.0', 'installer');
assert.equal(u.newer, false, 'a dev build ahead of the release is not offered a downgrade'); ok();
// Assets from anywhere but this project's releases are dropped.
u = U.describeRelease({ ...json, assets: [{ name: 'Lantern-0.3.2-x64.exe', browser_download_url: 'https://evil.example/Lantern-0.3.2-x64.exe', size: 1 }] }, '0.3.1', 'installer');
assert.equal(u.asset, null, 'a download outside the Lantern releases is never offered'); ok();
// Sparse replies still work.
u = U.describeRelease({ tag_name: 'v0.3.2' }, '0.3.1', 'installer');
assert.equal(u.newer, true); assert.equal(u.asset, null); assert.equal(u.name, 'Lantern 0.3.2'); assert.equal(u.notes, ''); assert.equal(u.url, U.RELEASES_URL); ok();
u = U.describeRelease({ tag_name: 'v0.3.2', assets: [null, 'x', { name: 1 }] }, '0.3.1', 'installer');
assert.equal(u.asset, null, 'malformed asset entries are ignored'); ok();
assert.throws(() => U.describeRelease({ message: 'Not Found' }, '0.3.1', 'installer'), /no release tag/); ok();
assert.throws(() => U.describeRelease(null, '0.3.1', 'installer')); ok();

/* ---------- sizes ---------- */
assert.equal(U.formatSize(112679048), '107 MB'); ok();
assert.equal(U.formatSize(5000), '5 KB'); ok();
assert.equal(U.formatSize(0), ''); ok();

console.log(`test-updates: ${n} checks passed`);
