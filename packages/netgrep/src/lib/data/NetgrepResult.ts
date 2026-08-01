import type { NetgrepCapture } from './NetgrepCapture.js';
import type { NetgrepMatchRange } from './NetgrepMatchRange.js';

/**
 * A result object returned for a search. The `T` generic carries the caller's
 * metadata; `C` mirrors `capture` in `NetgrepSearchConfig`, so the shape of
 * the result states what was asked for:
 *
 * - **`C = undefined`** — the default. No `line` or `ranges` key at all, so
 *   reading one is a compile error rather than a silent `undefined`.
 * - **`C = 'line'`** — `result` becomes a discriminant: narrow on it and
 *   `line` is a `string` needing no null check, because a line exists exactly
 *   when there was a match:
 *
 * ```ts
 * const res = await ng.search(url, pattern, undefined, { capture: 'line' });
 * if (res.result) console.log(res.line.toUpperCase()); // `line` is `string`
 * ```
 *
 * - **`C = 'line-ranges'`** — as `'line'`, plus `ranges`: where the pattern
 *   matches within `line`, as UTF-16 code-unit offsets, so
 *   `line.slice(start, end)` is the matched text. Usually non-empty on a
 *   match, but `[]` is reachable — every match can sit past the
 *   `maxLineBytes` cut — so do not assume `ranges[0]` exists.
 *
 * `line` can be an EMPTY STRING under either capturing mode — a pattern
 * matching an empty line did match, and `result` is the answer to whether it
 * did. Do not test `line` for truthiness.
 *
 * Two documented ways `line` can be less than a line of the file: non-UTF-8
 * bytes decode lossily, and inside a line longer than 64 KB it is a mid-line
 * fragment rather than a line (BACKLOG 3g).
 */
export type NetgrepResult<
  T extends object = object,
  C extends NetgrepCapture = undefined,
> = {
  url: string;
  pattern: string;
  metadata?: T;
} & (C extends 'line-ranges'
  ?
      | { result: true; line: string; ranges: Array<NetgrepMatchRange> }
      | { result: false; line: null; ranges: null }
  : C extends 'line'
    ? { result: true; line: string } | { result: false; line: null }
    : { result: boolean });
