/**
 * A result object returned for a search. The `T` generic
 * represents the metadata passed in the search method
 * used.
 *
 * The `L` generic mirrors `captureLine` in `NetgrepSearchConfig`, so the shape
 * of the result states whether a line was asked for:
 *
 * - **`L = false`** — the default, and what every existing caller gets. The
 *   type is exactly what it has always been: there is no `line` key at all, so
 *   reading one is a compile error rather than a silent `undefined`.
 * - **`L = true`** — `result` becomes a discriminant. Narrow on it and `line`
 *   is a `string` needing no null check, because a line exists exactly when
 *   there was a match:
 *
 * ```ts
 * const res = await ng.search(url, pattern, undefined, { captureLine: true });
 * if (res.result) console.log(res.line.toUpperCase()); // `line` is `string`
 * ```
 */
export type NetgrepResult<
  T extends object = object,
  L extends boolean = false,
> = {
  url: string;
  pattern: string;
  metadata?: T;
} & (L extends true
  ? /**
     * `line` is the first matching line of the file, with its terminator
     * removed and truncated to `maxLineBytes`.
     *
     * It can be an EMPTY STRING — a pattern matching an empty line did match,
     * and `result` is the answer to whether it did. Do not test `line` for
     * truthiness.
     *
     * Two documented ways it can be less than a line of the file: non-UTF-8
     * bytes decode lossily, and inside a line longer than 64 KB it is a
     * mid-line fragment rather than a line (BACKLOG 3g).
     */
    { result: true; line: string } | { result: false; line: null }
  : { result: boolean });
