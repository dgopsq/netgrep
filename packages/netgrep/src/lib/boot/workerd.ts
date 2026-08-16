import { initSync } from '@netgrep/search';
// The Workers bundler resolves a `.wasm` import to a compiled
// `WebAssembly.Module` and inlines the binary into the deployed script. There
// is no type for that, and an ambient `declare module '*.wasm'` would leak a
// wildcard module declaration into every consumer's program — so the error is
// suppressed here instead of declared away globally.
// @ts-expect-error the workerd bundler resolves this to a WebAssembly.Module
import wasm from '@netgrep/search/pkg/index_bg.wasm';

/**
 * A Worker cannot use the default loader: it fetches over the network at
 * module scope, and global-scope I/O is exactly what the runtime forbids.
 *
 * Instantiating an already-compiled module is not I/O, so this is allowed
 * where a fetch is not, and it keeps the eager contract — by the time a
 * request arrives the engine is up, and no request pays for the boot.
 */
initSync({ module: wasm });

export const wasmReady: Promise<unknown> = Promise.resolve();
