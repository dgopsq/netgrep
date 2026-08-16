/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initSync } from '@netgrep/search';

/**
 * Node's `fetch` refuses `file:` URLs, so the default loader cannot reach the
 * binary sitting next to it on disk — it fails, and because the failure lands
 * at module load rather than at the first search, it arrives as an unhandled
 * rejection that terminates the process.
 *
 * Reading it here is synchronous on purpose. `initSync` needs no top-level
 * await, so this module finishes booting before anything can import it, and
 * the eager contract every other runtime has is preserved exactly rather than
 * traded for a lazy path and a new export.
 *
 * The triple-slash reference above is what lets this compile while
 * `tsconfig.lib.json` keeps `"types": []` — Node's globals stay out of the
 * rest of the library, and only this file sees them.
 */
initSync({
  module: readFileSync(
    fileURLToPath(import.meta.resolve('@netgrep/search/pkg/index_bg.wasm')),
  ),
});

export const wasmReady: Promise<unknown> = Promise.resolve();
