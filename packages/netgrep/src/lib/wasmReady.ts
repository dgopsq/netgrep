import init from '@netgrep/search';

/**
 * The WASM module has to be instantiated before any engine call.
 *
 * Started once at module load and shared by every entry point: the download
 * begins as soon as the library is imported rather than on the first search,
 * and awaiting an already-settled promise costs nothing.
 *
 * Its own module so no entry point instantiates its own. Two
 * `init()` calls would be idempotent, but two module-level promises racing to
 * instantiate on a cold import is not something to rely on being harmless.
 *
 * Kept out of `index.ts` on purpose — callers should not have to know the
 * engine needs booting.
 */
export const wasmReady = init();
