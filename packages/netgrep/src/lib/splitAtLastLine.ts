/**
 * Ceiling on the bytes retained between two `fetch` chunks.
 *
 * Only terminator-free input reaches it — the tail is normally the incomplete
 * trailing line, 387 bytes at worst in the demo's log files. Past it the
 * guarantee weakens to "a boundary never hides a match shorter than 64 KB".
 *
 * A safety valve for input netgrep is not aimed at, so not configurable.
 */
export const MAX_TAIL_BYTES = 64 * 1024;

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
  /** Safe to hand to the engine. Empty when no complete line has arrived. */
  searchable: Uint8Array;

  /** Bytes to prepend to the next chunk. */
  tail: Uint8Array;

  /**
   * Whether `searchable` already covered `tail`.
   *
   * True only in the windowed case, where `searchable` is the whole buffer and
   * therefore includes the retained bytes. The caller must not search the tail
   * again when the stream ends: it would rescan up to `cap` bytes, and — because
   * a windowed tail starts mid-line — would let `^` match at the window's first
   * byte, inventing a match on a line that does not begin there.
   */
  tailSearched: boolean;
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
 * The two halves — views into `buffer`, not copies — and whether the tail still
 * needs searching.
 */
export function splitAtLastLine(buffer: Uint8Array, cap: number): BufferSplit {
  // `+ 1` cuts AFTER the terminator, so `searchable` is whole lines and `tail`
  // starts a fresh one. Absent a terminator this is 0 and everything waits.
  let cut = buffer.lastIndexOf(LINE_FEED) + 1;

  const windowed = buffer.length - cut > cap;

  if (windowed) cut = buffer.length - cap;

  return {
    // Searching the WHOLE buffer when windowed is required, not an optimisation:
    // the bytes between the last terminator and the new cut leave the tail, so
    // searching only `[0, cut)` would drop them unscanned and lose a match that
    // arrived complete in one chunk.
    searchable: windowed ? buffer : buffer.subarray(0, cut),
    tail: buffer.subarray(cut),
    tailSearched: windowed,
  };
}
