import type { NetgrepHit } from './data/NetgrepHit.js';
import type { NetgrepMatchRange } from './data/NetgrepMatchRange.js';

/** Where the per-hit records start: past `hitCount` and `linesInBlock`. */
const FIRST_RECORD = 2;

/**
 * How many lines the block contained, matching or not.
 *
 * The streaming loop advances its running file-absolute base by this, so it
 * counts a final line with no terminator too.
 */
export function linesInBlock(table: Uint32Array): number {
  return table[1];
}

/**
 * Walk one block's flat `text` and `table` back into hits.
 *
 * A generator, and lazily so: the caller renders and discards one hit at a
 * time, and a common token in a large log produces hundreds of thousands per
 * block. `indexOf` rather than `text.split('\n')` is what keeps that true —
 * splitting would allocate every line before the consumer read the first, which
 * is the eager materialisation the flat encoding exists to avoid.
 *
 * @param text
 * The matching lines, terminator-stripped, joined by `\n`. Unambiguous by
 * construction: a match can never span a `\n`, so no line can contain one.
 * @param table
 * `[hitCount, linesInBlock]`, then per hit `[lineNumber, nRanges, start, end,
 * …]`, where `nRanges` counts pairs.
 * @param linesBefore
 * How many lines of the file preceded this block. Block-relative line numbers
 * are 1-based, so this is a count and not an index.
 */
export function* decodeBlock(
  text: string,
  table: Uint32Array,
  linesBefore: number,
): Generator<NetgrepHit> {
  const hitCount = table[0];

  let cursor = FIRST_RECORD;
  let lineStart = 0;

  for (let hit = 0; hit < hitCount; hit += 1) {
    const lineNumber = table[cursor];
    const rangeCount = table[cursor + 1];

    cursor += 2;

    // The last line has no separator after it, so a missing one is the end of
    // the text rather than an error.
    const separator = text.indexOf('\n', lineStart);
    const lineEnd = separator === -1 ? text.length : separator;
    const line = text.slice(lineStart, lineEnd);

    lineStart = lineEnd + 1;

    const ranges: Array<NetgrepMatchRange> = [];

    for (let range = 0; range < rangeCount; range += 1) {
      ranges.push({ start: table[cursor], end: table[cursor + 1] });
      cursor += 2;
    }

    yield { line, ranges, lineNumber: linesBefore + lineNumber };
  }
}
