// Reproduce: load a minimal old-format world (no triggers field), add a trigger, save, read back.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// Stub electron's app.getPath to a temp dir so worlds.ts writes there.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-ws-'));
const shim = path.join(tmp, 'electron.mjs');
fs.writeFileSync(shim, `export const app = { getPath: () => ${JSON.stringify(tmp)} };`);
await build({ entryPoints: ['electron/worlds.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: path.join(tmp, 'worlds.mjs'), logLevel: 'silent',
  plugins: [{ name: 'e', setup(b){ b.onResolve({filter:/^electron$/}, () => ({ path: shim })); } }] });
const W = await import(pathToFileURL(path.join(tmp, 'worlds.mjs')).href);
// Minimal old-format world, exactly like the user's 225-byte file.
fs.writeFileSync(path.join(tmp, 'worlds.json'), JSON.stringify([{ id: 'abc', name: 'Haven - Test', host: 'havenrpg.net', port: 3000, encoding: 'utf-8', logging: true, createdAt: '2026-10-20T00:25:27.635Z' }], null, 2));
const loaded = W.loadWorlds();
console.log('loaded triggers field is array:', Array.isArray(loaded[0].triggers), '| log field:', !!loaded[0].log);
// Add a name-highlight trigger and save.
loaded[0].triggers.push({ id: 't1', name: 'Hi Logan', pattern: 'Logan', regex: true, enabled: true, group: 'names', ignoreCase: false, send: '', sendTo: 'world', highlight: '12', highlightLine: false, gag: false, oneShot: false });
loaded[0].log = { output: true, commands: true, notes: false, format: 'raw', file: 'Liesel-raw-%Y-%m-%d', worldNameHeader: true };
try {
  W.saveWorlds(loaded);
  const back = JSON.parse(fs.readFileSync(path.join(tmp, 'worlds.json'), 'utf-8'));
  console.log('AFTER SAVE -> triggers on disk:', back[0].triggers?.length, '| log.format:', back[0].log?.format);
  if ((back[0].triggers?.length ?? 0) === 1 && back[0].log?.format === 'raw') console.log('RESULT: save works — triggers and log persisted');
  else console.log('RESULT: BUG — changes did not persist');
} catch (e) { console.log('saveWorlds THREW:', e.message); }
fs.rmSync(tmp, { recursive: true, force: true });
