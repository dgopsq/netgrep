import { describe, expect, it } from 'vitest';
import { splitAtLastLine } from './splitAtLastLine.js';

// The buffer arithmetic behind BACKLOG 3a's fix, on its own.
//
// A pure function specifically so this can be a table in Node: reaching the
// windowed branches through `grep` needs a >64 KB fixture with no line
// breaks, which pins the same logic far more expensively.
//
// `cap` is 8 throughout, so the windowed cases fit on one line.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Run the split on a string, and read both halves back as strings. */
function split(input: string, cap = 8) {
  const { searchable, tail, tailSearched } = splitAtLastLine(
    encoder.encode(input),
    cap,
  );

  return {
    searchable: decoder.decode(searchable),
    tail: decoder.decode(tail),
    tailSearched,
  };
}

describe('splitAtLastLine', () => {
  it('searches the complete lines and carries the partial one', () => {
    expect(split('a\nbc')).toEqual({
      searchable: 'a\n',
      tail: 'bc',
      tailSearched: false,
    });
  });

  it('carries everything when no line has completed yet', () => {
    // BACKLOG 3a itself: searching these in isolation misses a word that
    // continues in the next chunk.
    expect(split('abc')).toEqual({
      searchable: '',
      tail: 'abc',
      tailSearched: false,
    });
  });

  it('carries nothing when the buffer ends exactly on a terminator', () => {
    expect(split('ab\n')).toEqual({
      searchable: 'ab\n',
      tail: '',
      tailSearched: false,
    });
  });

  it('splits at the LAST terminator, not the first', () => {
    expect(split('a\nb\ncd')).toEqual({
      searchable: 'a\nb\n',
      tail: 'cd',
      tailSearched: false,
    });
  });

  it('handles an empty buffer', () => {
    expect(split('')).toEqual({
      searchable: '',
      tail: '',
      tailSearched: false,
    });
  });

  it('keeps a whole-line tail regardless of how long it is, under the cap', () => {
    // Seven bytes of tail against a cap of eight: still exact, no window.
    expect(split('x\nabcdefg')).toEqual({
      searchable: 'x\n',
      tail: 'abcdefg',
      tailSearched: false,
    });
  });

  describe('past the ceiling', () => {
    it('falls back to a byte window when a line outgrows the cap', () => {
      // Ten bytes, no terminator, cap of eight: the tail windows the last eight
      // rather than keeping the whole line.
      expect(split('abcdefghij')).toEqual({
        searchable: 'abcdefghij',
        tail: 'cdefghij',
        tailSearched: true,
      });
    });

    it('searches the WHOLE buffer when it windows, dropping nothing', () => {
      // What a naive implementation gets wrong: cutting at `length - cap` and
      // searching only `[0, cut)` looks at 'ab' alone and retains 'cdefghij', so
      // a match spanning the two — complete in this one buffer — is never seen.
      expect(split('abcdefghij').searchable).toBe('abcdefghij');
    });

    it('reports a windowed tail as already searched', () => {
      // The caller must not search it again at end of stream. It was covered by
      // the whole-buffer search above, and searching it alone would treat its
      // first byte as a line start — letting `^` match a line starting earlier.
      expect(split('abcdefghij').tailSearched).toBe(true);
    });

    it('windows a partial line that outgrew the cap even with a terminator present', () => {
      // A buffer can hold a completed line and still have an over-long tail. The
      // tail windows to the cap, and the whole buffer is searched, so bytes
      // dropped from the tail are not dropped from the search.
      expect(split('a\nbcdefghijk')).toEqual({
        searchable: 'a\nbcdefghijk',
        tail: 'defghijk',
        tailSearched: true,
      });
    });

    it('is exactly at the cap without windowing', () => {
      // Eight bytes of tail against a cap of eight is not over it.
      expect(split('abcdefgh')).toEqual({
        searchable: '',
        tail: 'abcdefgh',
        tailSearched: false,
      });
    });
  });

  it('returns views, not copies', () => {
    // Called once per chunk, so the split must not add a copy on top of the
    // concatenation already being paid for.
    const buffer = encoder.encode('a\nbc');
    const { searchable, tail } = splitAtLastLine(buffer, 8);

    expect(searchable.buffer).toBe(buffer.buffer);
    expect(tail.buffer).toBe(buffer.buffer);
  });
});
