/**
 * The optional configuration passed in
 * a single search method.
 * @public
 */
export type NetgrepSearchConfig = {
  /**
   * A `Signal` used to abort the remote file
   * search and download.
   */
  signal?: AbortSignal;
};
