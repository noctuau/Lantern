/**
 * The one wasmoon factory for the renderer. Lua runs here, in the renderer,
 * because wasmoon is WebAssembly and everything a script touches (the session,
 * its world, the output pane) already lives in the store.
 *
 * glue.wasm is inlined as a data: URI (a virtual module from vite.config.ts)
 * rather than fetched by URL: the packaged app is loaded from file://, where
 * Chromium's fetch() refuses to run and emscripten has no fallback. The CSP in
 * index.html allows connect-src data: for exactly this one fetch.
 */
import { LuaFactory } from 'wasmoon';
import glueWasm from 'virtual:wasmoon-glue';

let factory: LuaFactory | null = null;

export function getLuaFactory(): LuaFactory {
  factory ??= new LuaFactory(glueWasm);
  return factory;
}
