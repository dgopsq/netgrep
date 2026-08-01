/**
 * What a search captures alongside the boolean.
 *
 * - `undefined` — membership only. The engine's boolean entry point; nothing
 *   is allocated, decoded or copied across the WebAssembly boundary.
 * - `'line'` — also the first matching line of the file.
 * - `'line-ranges'` — the line, plus every match's position within it.
 *
 * Each mode has its own engine entry point, so a caller pays only for the
 * mode it names.
 */
export type NetgrepCapture = 'line' | 'line-ranges' | undefined;
