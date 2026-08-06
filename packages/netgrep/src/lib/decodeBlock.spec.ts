import { describe, expect, it } from 'vitest';
import { decodeBlock, linesInBlock } from './decodeBlock.js';

/** Build a table from its parts, so a test reads as the layout it asserts. */
function table(
  lines: number,
  ...hits: Array<[lineNumber: number, ...ranges: Array<number>]>
): Uint32Array {
  const words: Array<number> = [hits.length, lines];

  for (const [lineNumber, ...ranges] of hits) {
    words.push(lineNumber, ranges.length / 2, ...ranges);
  }

  return new Uint32Array(words);
}

describe('decodeBlock', () => {
  it('yields nothing for a block with no hits', () => {
    expect([...decodeBlock('', table(12), 0)]).toEqual([]);
  });

  it('yields one hit with its line and ranges', () => {
    const hits = [...decodeBlock('alpha beta', table(3, [2, 0, 5]), 0)];

    expect(hits).toEqual([
      { line: 'alpha beta', ranges: [{ start: 0, end: 5 }], lineNumber: 2 },
    ]);
  });

  it('splits the joined text back into one line per hit', () => {
    const hits = [
      ...decodeBlock(
        'first\nsecond\nthird',
        table(9, [1, 0, 5], [4, 0, 6], [7, 0, 5]),
        0,
      ),
    ];

    expect(hits.map((hit) => hit.line)).toEqual(['first', 'second', 'third']);
    expect(hits.map((hit) => hit.lineNumber)).toEqual([1, 4, 7]);
  });

  it('unflattens several ranges within one line', () => {
    const hits = [...decodeBlock('a b a', table(1, [1, 0, 1, 4, 5]), 0)];

    expect(hits[0].ranges).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 5 },
    ]);
  });

  it('makes the line number file-absolute by adding the running base', () => {
    const hits = [...decodeBlock('x\ny', table(4, [2, 0, 1], [3, 0, 1]), 1000)];

    expect(hits.map((hit) => hit.lineNumber)).toEqual([1002, 1003]);
  });

  it('treats an EMPTY matching line as a line, not as absent text', () => {
    // A pattern matching an empty line yields an empty segment, and the
    // separator that follows it still belongs to the next hit. Reading this
    // wrong shifts every later line by one.
    const hits = [...decodeBlock('\nnext', table(5, [2, 0, 0], [3, 0, 4]), 0)];

    expect(hits.map((hit) => hit.line)).toEqual(['', 'next']);
    expect(hits[0].ranges).toEqual([{ start: 0, end: 0 }]);
  });

  it('yields a hit with no ranges at all without consuming a range pair', () => {
    // Guards the cursor arithmetic: a zero-pair record is 2 words, and
    // over-advancing here would read the next hit's line number as a range.
    const hits = [...decodeBlock('one\ntwo', table(2, [1], [2, 0, 3]), 0)];

    expect(hits.map((hit) => hit.lineNumber)).toEqual([1, 2]);
    expect(hits[0].ranges).toEqual([]);
    expect(hits[1].ranges).toEqual([{ start: 0, end: 3 }]);
  });

  it('reads the line count out of the table', () => {
    expect(linesInBlock(table(4096, [1, 0, 1]))).toBe(4096);
  });
});
