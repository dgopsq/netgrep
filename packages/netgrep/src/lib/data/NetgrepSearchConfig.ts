import type { NetgrepCapture } from './NetgrepCapture.js';

/**
 * The optional configuration passed in a single search method.
 *
 * The `C` generic is inferred from `capture` at the call site — constrained to
 * `NetgrepCapture` rather than typed as one, which is what makes TypeScript
 * keep the literal instead of widening it — and it decides the shape of the
 * result. See `NetgrepResult`.
 */
export type NetgrepSearchConfig<C extends NetgrepCapture = undefined> = {
  /**
   * A `Signal` used to abort the remote file search and download.
   */
  signal?: AbortSignal;

  /**
   * What to return alongside the boolean: nothing, the first matching line,
   * or the line plus every match's position within it.
   *
   * Off by default, and the cost really is zero when it is off: each mode has
   * a separate engine entry point, so nothing is allocated, decoded or copied
   * across the WebAssembly boundary for a caller who only wants membership.
   */
  capture?: C;

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
   * Typed `never` unless `capture` is set, so setting it on its own is a
   * compile error rather than a ceiling that silently governs nothing.
   */
  maxLineBytes?: C extends 'line' | 'line-ranges' ? number : never;
};
