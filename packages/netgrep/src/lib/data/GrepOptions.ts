/**
 * The optional configuration for a `grep` call.
 */
export type GrepOptions = {
  /**
   * Request options handed to `fetch` unchanged.
   *
   * How a file that needs an `Authorization` header, an API key or a cookie
   * (`credentials: 'include'`) is reached at all — netgrep owns the request
   * because it needs the response body to stream, so there is no other way in.
   *
   * It is also the only way to stop a search that is finding nothing: `signal`
   * lives here, and leaving the loop needs a hit to leave from.
   *
   * Passed through whole, so `method` and `body` come with it and are neither
   * honoured specially nor rejected. netgrep searches whatever body comes back
   * and validates nothing about the request first, so a request that returns
   * something other than the file is the caller's to get right.
   */
  fetch?: RequestInit;

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
