import init from '@netgrep/search';

/**
 * The default boot: fetch the binary the way a browser does.
 *
 * `init()` resolves `index_bg.wasm` relative to its own module URL over HTTP,
 * which is what the browser wants and what Deno's `file:`-capable `fetch`
 * handles unaided. It is also the loader the browser suite exercises, so this
 * path is the one under test in `grep.integration.spec.ts`.
 */
export const wasmReady: Promise<unknown> = init();
