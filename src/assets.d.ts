// Virtual modules provided by plugins in vite.config.ts (this file must stay import-free so these are ambient).
declare module 'virtual:wasmoon-glue' {
  /** wasmoon's glue.wasm as a data: URI. */
  const dataUri: string;
  export default dataUri;
}
