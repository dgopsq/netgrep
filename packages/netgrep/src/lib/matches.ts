import { search_bytes } from '@netgrep/search';
import type { MatchesOptions } from './data/MatchesOptions.js';
import { streamBlocks } from './streamBlocks.js';
import { wasmReady } from './wasmReady.js';

/**
 * Answer whether a remote file contains a match, reading no more than it must.
 *
 * The first hit ends the transfer, so a match near the head of a 240 MB file
 * costs a few chunks rather than the file. A file with no match is read to the
 * end, because proving an absence is what that takes.
 *
 * Nothing crosses out of WebAssembly but the boolean — no line is copied and no
 * terminator is counted, which is why this is cheaper than `grep` rather than
 * merely narrower. Use `grep` when the answer is which lines matched.
 *
 * @param url
 * The url to the remote file.
 * @param pattern
 * The pattern to search for. Anything `ripgrep` can understand, matched with
 * smart case: lowercase is case-insensitive, any uppercase character makes it
 * case-sensitive.
 * @param options
 * Optional `MatchesOptions` — request options and a progress callback.
 * @returns
 * Whether any line of the file matched. Rejects if the pattern will not
 * compile, if the request fails, and if it is aborted.
 */
export async function matches(
  url: string,
  pattern: string,
  options?: MatchesOptions,
): Promise<boolean> {
  await wasmReady;

  // Compile before the connection opens. Reaching the engine with the first
  // chunk instead spends a request on a 240 MB file to discover an unclosed
  // `[`; the engine memoises the compiled matcher, so the real search reuses
  // this one and the check costs nothing.
  search_bytes(new Uint8Array(0), pattern);

  for await (const block of streamBlocks(url, options)) {
    // Returning leaves the `for await`, which runs the generator's `finally`
    // and cancels the reader — so the answer terminates the transfer instead
    // of leaving the rest of the file to arrive and be paid for.
    if (search_bytes(block, pattern)) return true;
  }

  return false;
}
