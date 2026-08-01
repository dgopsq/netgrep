import type { NetgrepCapture } from './NetgrepCapture.js';
import type { NetgrepResult } from './NetgrepResult.js';

/**
 * Type representing a `NetgrepResult` for a batch
 * search.
 *
 * `C` threads through from the search config exactly as it does for
 * `NetgrepResult`. A url that failed comes back as `result: false` — and so,
 * when capture was asked for, as `line: null` (and `ranges: null`): an error
 * is not a match.
 */
export type BatchNetgrepResult<
  T extends object = object,
  C extends NetgrepCapture = undefined,
> = NetgrepResult<T, C> & {
  error: string | null;
};
