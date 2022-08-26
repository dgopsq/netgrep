import { NetgrepResult } from './NetgrepResult';

/**
 *
 */
export type BatchNetgrepResult<T extends object = object> = NetgrepResult<T> & {
  error: string | null;
};
