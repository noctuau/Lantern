import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Serves wasmoon's glue.wasm as a data: URI in a virtual module. The packaged app is
 * loaded from file://, where Chromium's fetch() cannot load a .wasm by URL, so the
 * binary travels inside the bundle (see src/lib/lua-wasm.ts).
 */
function inlineWasmoon(): Plugin {
  const id = 'virtual:wasmoon-glue';
  const resolved = '\0' + id;
  return {
    name: 'lantern-inline-wasmoon',
    resolveId(source) { return source === id ? resolved : null; },
    load(file) {
      if (file !== resolved) return null;
      const wasm = fs.readFileSync(fileURLToPath(new URL('./node_modules/wasmoon/dist/glue.wasm', import.meta.url)));
      return `export default ${JSON.stringify('data:application/wasm;base64,' + wasm.toString('base64'))};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineWasmoon()],
  base: './',
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist' },
});
