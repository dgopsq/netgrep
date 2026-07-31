/**
 * The optional configuration passed in
 * a single search method.
 *
 * The `L` generic is inferred from `captureLine` at the call site — it is
 * *constrained* to `boolean` rather than typed as one, which is what makes
 * TypeScript keep the literal `true` instead of widening it — and it decides
 * the shape of the result. See `NetgrepResult`.
 */
export type NetgrepSearchConfig<L extends boolean = false> = {
  /**
   * A `Signal` used to abort the remote file
   * search and download.
   */
  signal?: AbortSignal;

  /**
   * Return the first matching line alongside the boolean.
   *
   * Off by default, and the cost really is zero when it is off: the engine has
   * a separate entry point for this, so nothing is allocated, decoded or copied
   * across the WebAssembly boundary for a caller who only wants membership.
   */
  captureLine?: L;

  /**
   * Ceiling on the bytes of the returned line. Defaults to 4096.
   *
   * Truncation happens inside WebAssembly, before the copy, so a corpus
   * containing minified JavaScript or a one-line data dump cannot move
   * megabytes per file into JavaScript. The cut is taken on a UTF-8 character
   * boundary, and applies to the line's content — the terminator is stripped
   * first.
   *
   * Values below 1, and fractions, are clamped rather than rejected: the number
   * becomes a Rust `usize`, and wasm-bindgen does not validate it.
   *
   * Typed `never` unless `captureLine` is `true`, so setting it on its own is a
   * compile error rather than a ceiling that silently governs nothing.
   */
  maxLineBytes?: L extends true ? number : never;
};
