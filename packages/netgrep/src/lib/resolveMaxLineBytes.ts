/**
 * Ceiling on the returned line when `capture` is set and the caller names no
 * other. Far past any line of prose, and small enough that a minified bundle
 * costs a snippet rather than a copy of itself.
 */
const DEFAULT_MAX_LINE_BYTES = 4096;

/**
 * The largest cap a Rust `usize` receives intact on wasm32.
 */
const MAX_LINE_BYTES_CEILING = 0xffffffff;

/**
 * Clamp a caller-supplied `maxLineBytes` into something the engine can hold.
 *
 * Clamped rather than validated: throwing would be a new failure mode for a
 * cosmetic setting, and wasm-bindgen checks nothing.
 *
 * ⚠️ THE UPPER BOUND MATTERS AS MUCH AS THE LOWER ONE. The number crosses the
 * boundary through ToUint32, which WRAPS rather than saturates, so `Infinity`,
 * `NaN` and 2³² all arrive as **0** — and a cap of 0 returns an empty string
 * for every match, which is exactly how a match on an empty line is reported.
 * Unbounded, the obvious way to ask for no cap silently produced the one result
 * this API cannot afford to be ambiguous about.
 */
export function resolveMaxLineBytes(requested: number | undefined): number {
  // Not a request for anything.
  if (requested === undefined || Number.isNaN(requested)) {
    return DEFAULT_MAX_LINE_BYTES;
  }

  // `Infinity` is how a caller spells "no cap", so it becomes the largest cap
  // rather than falling back to the default and quietly ignoring them.
  if (requested >= MAX_LINE_BYTES_CEILING) return MAX_LINE_BYTES_CEILING;

  return Math.max(1, Math.floor(requested));
}
