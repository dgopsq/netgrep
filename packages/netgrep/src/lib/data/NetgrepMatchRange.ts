/**
 * One match's position within a captured line.
 *
 * `start` and `end` are UTF-16 code-unit offsets into the `line` string —
 * JavaScript's native string indexing — so `line.slice(start, end)` is the
 * matched text with no conversion. They are NOT byte offsets, and they are
 * relative to the returned (truncated, decoded) line, never to the file.
 */
export type NetgrepMatchRange = {
  start: number;
  end: number;
};
