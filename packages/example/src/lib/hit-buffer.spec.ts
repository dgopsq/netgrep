import type { NetgrepHit } from '@netgrep/netgrep';
import { describe, expect, it } from 'vitest';
import { HitBuffer, MAX_RETAINED_HITS } from './hit-buffer';

function hit(lineNumber: number): NetgrepHit {
  return { line: `line ${lineNumber}`, ranges: [], lineNumber };
}

describe('HitBuffer', () => {
  it('starts empty and untruncated', () => {
    const buffer = new HitBuffer();

    expect(buffer.total).toBe(0);
    expect(buffer.retained).toBe(0);
    expect(buffer.truncated).toBe(false);
    expect(buffer.hits).toEqual([]);
  });

  it('retains hits in the order they arrive', () => {
    const buffer = new HitBuffer();

    buffer.push(hit(1));
    buffer.push(hit(9));

    expect(buffer.hits.map((h) => h.lineNumber)).toEqual([1, 9]);
    expect(buffer.total).toBe(2);
    expect(buffer.retained).toBe(2);
    expect(buffer.truncated).toBe(false);
  });

  // Past the ceiling the count keeps rising and the array does not. A page that
  // stopped counting would report a total set by its own memory budget.
  it('keeps counting past the ceiling but stops storing', () => {
    const buffer = new HitBuffer();

    for (let i = 1; i <= MAX_RETAINED_HITS + 3; i += 1) buffer.push(hit(i));

    expect(buffer.total).toBe(MAX_RETAINED_HITS + 3);
    expect(buffer.retained).toBe(MAX_RETAINED_HITS);
    expect(buffer.truncated).toBe(true);
  });

  // The hook hands this array to the virtualizer once and re-renders on the
  // count, so replacing it per push would defeat that.
  it('never replaces the hits array', () => {
    const buffer = new HitBuffer();
    const before = buffer.hits;

    buffer.push(hit(1));

    expect(buffer.hits).toBe(before);
  });

  it('drops the hits past the ceiling rather than the ones before it', () => {
    const buffer = new HitBuffer();

    for (let i = 1; i <= MAX_RETAINED_HITS + 1; i += 1) buffer.push(hit(i));

    expect(buffer.hits[0]?.lineNumber).toBe(1);
    expect(buffer.hits[MAX_RETAINED_HITS - 1]?.lineNumber).toBe(
      MAX_RETAINED_HITS,
    );
  });
});
