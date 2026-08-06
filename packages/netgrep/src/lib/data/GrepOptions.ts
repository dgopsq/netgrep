/**
 * The optional configuration for a `grep` call.
 */
export type GrepOptions = {
  /**
   * Ceiling on the bytes of each yielded line. Defaults to 4096.
   *
   * Truncation happens inside WebAssembly, before the copy, so a minified
   * bundle or a one-line data dump cannot move megabytes per file into
   * JavaScript. The cut is taken on a UTF-8 character boundary, and applies to
   * the line's content — the terminator is stripped first.
   *
   * Values below 1, and fractions, are clamped rather than rejected: the
   * number becomes a Rust `usize`, and wasm-bindgen does not validate it.
   */
  maxLineBytes?: number;

  /**
   * Called after each network chunk with the cumulative bytes read.
   *
   * These are DECOMPRESSED bytes delivered to the page, not bytes on the wire:
   * a gzipped response moves far fewer. No total is offered to compare them
   * against, because `Content-Length` on a compressed response is the
   * compressed size and would drive a bar that finishes at a few per cent.
   */
  onProgress?: (bytesRead: number) => void;
};
