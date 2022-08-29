/**
 * Type representing a single search target in a
 * batch search. The `T` generic is for the metadata
 * that will be returned back in the result object.
 * @public
 */
export type NetgrepInput<T extends object = object> = {
  url: string;
  metadata?: T;
};
