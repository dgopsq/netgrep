import { concatBytes } from './concatBytes.js';
import { MAX_TAIL_BYTES, splitAtLastLine } from './splitAtLastLine.js';

/**
 * Fetch a url and yield its bytes as blocks of whole lines.
 *
 * The engine only ever sees complete lines: a match cannot span a `\n`, so the
 * incomplete trailing line is the exact carry-over between network chunks, and
 * a chunk boundary can neither hide a match nor fake a line start for `^`.
 *
 * Nothing accumulates. One chunk plus that trailing line, bounded at 64 KB,
 * however large the file — which is what makes the memory cost independent of
 * the response size.
 *
 * Shared by every entry point that streams, because this is the part where a
 * bug is expensive and the part both of them would otherwise duplicate.
 *
 * @param url
 * The url to read.
 * @param options.fetch
 * Request options, handed to `fetch` unchanged.
 * @param options.onProgress
 * Called after each chunk with the cumulative decompressed bytes delivered.
 */
export async function* streamBlocks(
  url: string,
  options?: {
    fetch?: RequestInit;
    onProgress?: (bytesRead: number) => void;
  },
): AsyncGenerator<Uint8Array> {
  const response = await fetch(url, options?.fetch);

  if (!response.body) {
    throw new Error("The response doesn't contain a body");
  }

  const reader = response.body.getReader();

  // The incomplete final line seen so far, held back until the rest of it
  // arrives. Annotated because `subarray` yields an `ArrayBufferLike` view,
  // which the inferred type would reject.
  let tail: Uint8Array = new Uint8Array(0);

  // Whether `tail` still needs yielding when the stream ends. False in the
  // windowed case, where it went out already as part of the whole buffer.
  let tailPending = false;

  let bytesRead = 0;

  try {
    for (;;) {
      const { value, done } = await reader.read();

      if (done) {
        // A genuine final line rather than a fragment, and skipping it would
        // lose the last line of every file not ending in a newline.
        //
        // Only when it has not gone out already. A windowed tail was covered
        // by the whole-buffer block that produced it, and yielding it alone
        // would treat its first byte as a line start — letting `^` match a
        // line that begins earlier.
        if (tailPending && tail.length > 0) yield tail;

        return;
      }

      bytesRead += value.length;
      options?.onProgress?.(bytesRead);

      const {
        searchable,
        tail: nextTail,
        tailSearched,
      } = splitAtLastLine(
        tail.length > 0 ? concatBytes([tail, value]) : value,
        MAX_TAIL_BYTES,
      );

      tail = nextTail;
      tailPending = !tailSearched;

      // A chunk that completed no line yields nothing and grows the tail.
      if (searchable.length > 0) yield searchable;
    }
  } finally {
    // Terminate the transfer rather than abandon it: `break`, `throw` and an
    // early `return` from the consumer all land here, and an abandoned reader
    // leaves the request open so the rest of the file keeps arriving and is
    // paid for. Unconditional because cancelling an already-closed stream is
    // defined as a no-op, which is cheaper than a branch that has to be right.
    // Rejections are ignored: a stream that has errored rejects here.
    await reader.cancel().catch(() => {});
  }
}
