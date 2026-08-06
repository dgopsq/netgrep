import { search_block, search_bytes } from '@netgrep/search';
import type { GrepOptions } from './data/GrepOptions.js';
import type { NetgrepHit } from './data/NetgrepHit.js';
import { decodeBlock, linesInBlock } from './decodeBlock.js';
import { resolveMaxLineBytes } from './resolveMaxLineBytes.js';
import { streamBlocks } from './streamBlocks.js';
import { wasmReady } from './wasmReady.js';

/**
 * Search a remote file and yield every matching line as it is found.
 *
 * Hits arrive while the file is still downloading, and memory stays flat
 * however large it is: one network chunk and the incomplete line at its end
 * are all that is ever held, and each hit is built at the moment it is yielded.
 *
 * Iteration drives everything. Nothing is fetched until the first `next()`, so
 * a pattern that will not compile throws from the loop rather than from this
 * call; and leaving the loop with `break`, `return` or a `throw` terminates the
 * transfer instead of leaving the rest of the file to arrive unread.
 *
 * An error can arrive AFTER hits have already been yielded — a connection that
 * drops at 180 MB gives every hit up to that point and then throws. Those hits
 * are correct and complete for the bytes that were read.
 *
 * @param url
 * The url to the remote file.
 * @param pattern
 * The pattern to search for. Anything `ripgrep` can understand, matched with
 * smart case: lowercase is case-insensitive, any uppercase character makes it
 * case-sensitive.
 * @param options
 * Optional `GrepOptions` — the per-line byte cap and a progress callback.
 * @returns
 * An async iterable of `NetgrepHit`, in file order.
 */
export async function* grep(
  url: string,
  pattern: string,
  options?: GrepOptions,
): AsyncGenerator<NetgrepHit> {
  await wasmReady;

  // Compile before the connection opens. Reaching the engine with the first
  // chunk instead spends a request on a 240 MB file to discover an unclosed
  // `[`; the engine memoises the compiled matcher, so the real search reuses
  // this one and the check costs nothing.
  search_bytes(new Uint8Array(0), pattern);

  const maxLineBytes = resolveMaxLineBytes(options?.maxLineBytes);

  // Lines of the file that came before the current block. Advanced by what the
  // engine counted, because counting terminators in JavaScript would mean
  // walking every byte of the file in the slowest language on the path.
  let linesBefore = 0;

  for await (const block of streamBlocks(url, options)) {
    const hits = search_block(block, pattern, maxLineBytes);

    // Read out, then free: the carrier owns WASM memory, and waiting for GC
    // would leak it for the page's lifetime under engines without weak-ref
    // finalization.
    const text = hits.text;
    const table = hits.table;
    hits.free();

    yield* decodeBlock(text, table, linesBefore);

    linesBefore += linesInBlock(table);
  }
}
