import { logUrl, sources } from '@/data/logs';

/**
 * How many bytes of each log file actually reached the search before netgrep
 * stopped the transfer.
 *
 * ⚠️ **THESE ARE DECOMPRESSED BYTES, NOT BYTES ON THE WIRE.** The logs are
 * served gzipped and compress about 16×, so the transfer that carried a figure
 * reported here was a small fraction of it. Anything that puts one of these
 * numbers on the page has to say which it is; presented as bandwidth it is a
 * lie by a factor of sixteen.
 *
 * PATCHING A GLOBAL IS ACCEPTABLE HERE AND WOULD NOT BE IN THE LIBRARY. This
 * page owns its own document, nothing but netgrep fetches these four URLs, and
 * the library is untouched — there is no other seam, because netgrep calls
 * `fetch` internally and takes no hook for it. Every other response, the
 * WebAssembly binary and `manifest.json` included, is handed to the original
 * `fetch` and never wrapped.
 *
 * The browser's own Resource Timing entries are not an alternative: an aborted
 * transfer reports `encodedBodySize: 0` in Chromium, which is exactly the case
 * this page exists to show, and a cache hit reports a full body behind a
 * `transferSize` of 300.
 */

/** The four log URLs, as pathnames. Nothing else is counted. */
const TRACKED = new Set(
  sources.map((source) => new URL(logUrl(source), location.href).pathname),
);

/** Bytes delivered so far in the current run, per tracked pathname. */
const delivered = new Map<string, number>();

/**
 * Which run a byte belongs to. A keystroke aborts four downloads mid-chunk, and
 * an aborted stream can still deliver one more chunk after the next run has
 * started — without this that chunk lands in the new run's total and the page
 * reports a source as having read more than it did.
 */
let run = 0;

let installed = false;

/** Zero the counters and disown anything still arriving from the last run. */
export function beginScanRun(): void {
  run += 1;
  delivered.clear();
}

/** Bytes of `url` delivered so far in the current run. */
export function scannedBytes(url: string): number {
  return delivered.get(new URL(url, location.href).pathname) ?? 0;
}

/**
 * Wrap `window.fetch` so the log responses are counted as they stream. Safe to
 * call more than once; only the first call wraps anything.
 */
export function installScanMeter(): void {
  if (installed) return;
  installed = true;

  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (input, init) => {
    // ⚠️ Three input shapes, and only one of them has a `.url`. wasm-bindgen's
    // loader passes a `URL` object, whose `.url` is `undefined` — a wrapper
    // that assumes a string throws here and takes the whole page down before
    // anything renders.
    const raw = input instanceof Request ? input.url : String(input);
    const path = new URL(raw, location.href).pathname;

    if (!TRACKED.has(path)) return original(input, init);

    const startedIn = run;

    return original(input, init).then((res) => {
      if (!res.body) return res;

      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (startedIn === run) {
            delivered.set(path, (delivered.get(path) ?? 0) + chunk.byteLength);
          }
          controller.enqueue(chunk);
        },
      });

      // Cancelling the piped stream cancels the fetch body upstream, so
      // netgrep's early exit still terminates the transfer rather than merely
      // stopping this counter. The count is a chunk or so ahead of what the
      // engine saw, since the pipe holds one in flight; against 8 MB it is
      // noise, and the alternative is to leave the transfer running.
      return new Response(res.body.pipeThrough(counter), res);
    });
  };
}
