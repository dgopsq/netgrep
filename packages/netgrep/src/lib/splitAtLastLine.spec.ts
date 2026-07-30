import { describe, expect, it } from 'vitest';
import { splitAtLastLine } from './splitAtLastLine.js';

/**
 * The buffer arithmetic behind BACKLOG 3a's fix, on its own.
 *
 * A pure function specifically so this can be a table in Node: reaching the
 * over-the-ceiling branches through `Netgrep.search` needs a >64 KB fixture with
 * no line breaks, which pins the same logic far more expensively. The real
 * ceiling is exercised end-to-end in `Netgrep.integration.spec.ts`.
 *
 * `cap` is 8 throughout, so the overflow cases fit on one line.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Run the split on a string, and read both halves back as strings. */
function split(input: string, cap = 8) {
  const { searched, tail } = splitAtLastLine(encoder.encode(input), cap);

  return { searched: decoder.decode(searched), tail: decoder.decode(tail) };
}

describe('splitAtLastLine', () => {
  it('searches the complete lines and carries the partial one', () => {
    expect(split('a\nbc')).toEqual({ searched: 'a\n', tail: 'bc' });
  });

  it('carries everything when no line has completed yet', () => {
    // BACKLOG 3a itself: searching these in isolation misses a word that
    // continues in the next chunk.
    expect(split('abc')).toEqual({ searched: '', tail: 'abc' });
  });

  it('carries nothing when the buffer ends exactly on a terminator', () => {
    expect(split('ab\n')).toEqual({ searched: 'ab\n', tail: '' });
  });

  it('splits at the LAST terminator, not the first', () => {
    expect(split('a\nb\ncd')).toEqual({ searched: 'a\nb\n', tail: 'cd' });
  });

  it('handles an empty buffer', () => {
    expect(split('')).toEqual({ searched: '', tail: '' });
  });

  it('keeps a whole-line tail regardless of how long it is, under the cap', () => {
    // Seven bytes of tail against a cap of eight: still exact, no window.
    expect(split('x\nabcdefg')).toEqual({ searched: 'x\n', tail: 'abcdefg' });
  });

  describe('past the ceiling', () => {
    it('falls back to a byte window when a line outgrows the cap', () => {
      // Ten bytes, no terminator, cap of eight: the tail windows the last eight
      // rather than keeping the whole line.
      expect(split('abcdefghij')).toEqual({
        searched: 'abcdefghij',
        tail: 'cdefghij',
      });
    });

    it('searches the WHOLE buffer when it windows, dropping nothing', () => {
      // What a naive implementation gets wrong: cutting at `length - cap` and
      // searching only `[0, cut)` looks at 'ab' alone and retains 'cdefghij', so
      // a match spanning the two — complete in this one buffer — is never seen.
      const { searched } = split('abcdefghij');

      expect(searched).toBe('abcdefghij');
    });

    it('windows a partial line that outgrew the cap even with a terminator present', () => {
      // A buffer can hold a completed line and still have an over-long tail. The
      // tail windows to the cap, and the whole buffer is searched, so bytes
      // dropped from the tail are not dropped from the search.
      expect(split('a\nbcdefghijk')).toEqual({
        searched: 'a\nbcdefghijk',
        tail: 'defghijk',
      });
    });

    it('is exactly at the cap without windowing', () => {
      // Eight bytes of tail against a cap of eight is not over it.
      expect(split('abcdefgh')).toEqual({ searched: '', tail: 'abcdefgh' });
    });
  });

  it('returns views, not copies', () => {
    // Called once per chunk, so the split must not add a copy on top of the
    // concatenation already being paid for.
    const buffer = encoder.encode('a\nbc');
    const { searched, tail } = splitAtLastLine(buffer, 8);

    expect(searched.buffer).toBe(buffer.buffer);
    expect(tail.buffer).toBe(buffer.buffer);
  });
});
