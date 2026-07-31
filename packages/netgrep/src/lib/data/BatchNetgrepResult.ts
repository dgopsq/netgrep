import type { NetgrepResult } from './NetgrepResult.js';

/**
 * Type representing a `NetgrepResult` for a batch
 * search.
 *
 * `L` threads through from the search config exactly as it does for
 * `NetgrepResult`. A url that failed comes back as `result: false` — and so,
 * when a line was asked for, as `line: null`: an error is not a match.
 */
export type BatchNetgrepResult<
  T extends object = object,
  L extends boolean = false,
> = NetgrepResult<T, L> & {
  error: string | null;
};
