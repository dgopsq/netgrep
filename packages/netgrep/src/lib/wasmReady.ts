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
 *
 * WHICH boot runs is chosen by the runtime, through the `#wasm-boot` condition
 * map in this package's manifest: a browser fetches the binary, Node reads it
 * from disk and a Worker receives it from its bundler. The boot is eager in
 * all three, so nothing here defers and no caller has to opt in. See decision
 * 0029.
 */
export { wasmReady } from '#wasm-boot';
