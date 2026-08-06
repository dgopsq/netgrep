import type { GrepOptions } from './GrepOptions.js';

/**
 * The optional configuration for a `matches` call.
 *
 * `GrepOptions` without `maxLineBytes`: `matches` answers with a boolean and
 * never copies a line out of WebAssembly, so there is no line length to bound.
 */
export type MatchesOptions = Omit<GrepOptions, 'maxLineBytes'>;
