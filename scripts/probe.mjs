// Quick protocol probe: connect to a MUD login screen for a few seconds and report what was negotiated.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
await build({ entryPoints: ['electron/telnet.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-electron/telnet-probe.mjs', logLevel: 'silent' });
const { TelnetSession } = await import(pathToFileURL('dist-electron/telnet-probe.mjs').href);
const [host, port] = process.argv.slice(2);
const t = new TelnetSession({ host, port: Number(port) });
let text = '';
t.on('text', (s) => { text += s; });
t.on('status', (st, m) => console.log('[status]', st, m ?? ''));
t.on('info', (m) => console.log('[info]', m));
t.on('gmcp', (p, d) => console.log('[gmcp]', p, JSON.stringify(d).slice(0, 80)));
t.on('prompt', () => console.log('[prompt]'));
t.connect();
setTimeout(() => {
  t.disconnect();
  console.log(`[bytes in] ${t.bytesIn}  compressed=${t.compressed} gmcp=${t.gmcpEnabled}`);
  console.log('--- first 600 chars (escapes shown) ---');
  console.log(JSON.stringify(text.slice(0, 600)));
  process.exit(0);
}, 4000);
