/**
 * A result object returned for a search. The `T` generic
 * represents the metadata passed in the search method
 * used.
 */
export type NetgrepResult<T extends object = object> = {
  url: string;
  pattern: string;
  result: boolean;
  metadata?: T;
};
