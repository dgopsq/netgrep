import { NetgrepResult } from './NetgrepResult';

/**
 *
 */
export type BatchNetgrepResult = NetgrepResult & { error: string | null };
