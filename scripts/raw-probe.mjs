// Dump the raw ANSI a server sends (telnet negotiation stripped, escapes shown) for a few seconds.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
await build({ entryPoints: ['electron/telnet.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/telnet-raw.mjs', logLevel: 'silent' });
const { TelnetSession } = await import(pathToFileURL('dist-electron/telnet-raw.mjs').href);
const [host, port] = process.argv.slice(2);
const t = new TelnetSession({ host, port: Number(port) });
let buf = '';
t.on('text', (s) => { buf += s; });
t.on('status', (st) => { if (st === 'connected') process.stderr.write('[connected]\n'); });
t.connect();
setTimeout(() => {
  t.disconnect();
  // Show escapes as \e[...] so colour codes are visible.
  const shown = buf.replace(/\x1b/g, '\e').replace(/\r/g, '');
  process.stdout.write(shown.slice(0, 2500));
  process.exit(0);
}, 5000);
