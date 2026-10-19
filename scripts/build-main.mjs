// Bundles the Electron main + preload processes with esbuild.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  outdir: 'dist-electron',
  sourcemap: true,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['electron/main.ts'], format: 'cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], format: 'cjs' });
