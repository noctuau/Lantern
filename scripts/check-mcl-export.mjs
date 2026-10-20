// Parse a MUSHclient export/plugin/world file and report what Lantern would import.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
await build({ entryPoints: ['electron/mcl.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/mcl-check.mjs', logLevel: 'silent' });
const m = await import(pathToFileURL('dist-electron/mcl-check.mjs').href);
const xml = fs.readFileSync(process.argv[2], 'latin1');
const t = m.importMclTriggers(xml), a = m.importMclAliases(xml), ti = m.importMclTimers(xml);
console.log(`${process.argv[2]}: ${t.length} triggers, ${a.length} aliases, ${ti.length} timers`);
for (const x of t.slice(0, 4)) console.log('  trigger', JSON.stringify({ name: x.name, pattern: x.pattern, regex: x.regex, send: x.send.slice(0, 40), highlight: x.highlight, gag: x.gag }));
for (const x of a.slice(0, 3)) console.log('  alias', JSON.stringify({ name: x.name, pattern: x.pattern, send: x.send.slice(0, 40) }));
