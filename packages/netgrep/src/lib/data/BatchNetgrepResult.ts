import { NetgrepResult } from './NetgrepResult.js';

/**
 * Type representing a `NetgrepResult` for a batch
 * search.
 * @public
 */
export type BatchNetgrepResult<T extends object = object> = NetgrepResult<T> & {
  error: string | null;
};
