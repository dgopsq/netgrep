/**
 *
 */
export type NetgrepResult<T extends object = object> = {
  url: string;
  result: boolean;
  metadata?: T;
};
