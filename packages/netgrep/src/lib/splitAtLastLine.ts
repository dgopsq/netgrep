/**
 * The only byte that ends a line here: `packages/search` builds its matcher with
 * `line_terminator(Some(b'\n'))` and no multi-line mode.
 */
const LINE_FEED = 0x0a;

/**
 * A buffer divided into what can be searched now and what must wait.
 *
 * Not under `data/` — everything there is published API surface; this is
 * internal to the streaming loop.
 */
type BufferSplit = {
  /** Safe to search. Empty when no complete line has arrived yet. */
  searched: Uint8Array;

  /**
   * Bytes to prepend to the next chunk. NOT yet searched — the caller must
   * search it when the stream ends, or the final line is lost.
   */
  tail: Uint8Array;
};

/**
 * Split a buffer at its last line terminator, so a match straddling a `fetch`
 * chunk boundary is still found.
 *
 * A match can never span a `\n` — the matcher rejects patterns that could match
 * the terminator and strips it from character classes — so the incomplete
 * trailing line is the *exact* carry-over between chunks, with no guess at match
 * length. Asserted by `test_a_match_cannot_span_a_line_terminator` in
 * `packages/search/tests/search.rs`, which names this function; if it goes red,
 * that invariant no longer holds and this function is wrong.
 *
 * @param buffer
 * The previous chunk's retained tail followed by the new chunk.
 * @param cap
 * Ceiling on the returned `tail`, without which one terminator-free line would
 * buffer an entire response. Past it, exactness degrades to a plain byte window:
 * a match shorter than `cap` still survives the boundary, a longer one does not.
 * @returns
 * The two halves, as views into `buffer` rather than copies.
 */
export function splitAtLastLine(buffer: Uint8Array, cap: number): BufferSplit {
  // `+ 1` cuts AFTER the terminator, so `searched` is whole lines and `tail`
  // starts a fresh one. Absent a terminator this is 0 and everything waits.
  let cut = buffer.lastIndexOf(LINE_FEED) + 1;

  const overflowing = buffer.length - cut > cap;

  if (overflowing) cut = buffer.length - cap;

  return {
    // Required, not an optimisation: when overflowing, the bytes between the
    // last terminator and the new cut leave the tail, so searching only
    // `[0, cut)` would drop them unscanned and lose a match that arrived whole.
    searched: overflowing ? buffer : buffer.subarray(0, cut),
    tail: buffer.subarray(cut),
  };
}
