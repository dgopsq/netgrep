import { describe, expect, it } from 'vitest';
import { activeHeadingIndex } from './active-heading';

describe('activeHeadingIndex', () => {
  it('returns -1 when there are no headings', () => {
    expect(activeHeadingIndex([], 0, 800, 2000)).toBe(-1);
  });

  it('activates the first heading when scrolled above it', () => {
    const tops = [500, 1000, 1500];
    expect(activeHeadingIndex(tops, 0, 800, 3000)).toBe(0);
  });

  it('activates a heading exactly when its top reaches the activation line', () => {
    const tops = [500, 1000, 1500];
    // activationLine = scrollY + 0.1 * viewportHeight = 920 + 80 = 1000
    expect(activeHeadingIndex(tops, 920, 800, 3000)).toBe(1);
  });

  it('activates the earlier heading when scrolled between two', () => {
    const tops = [500, 1000, 1500];
    // activationLine = 620 + 80 = 700, between tops[0] and tops[1]
    expect(activeHeadingIndex(tops, 620, 800, 3000)).toBe(0);
  });

  it('pins a heading landing exactly on the activation line, rather than the one before it', () => {
    const tops = [0, 400];
    // activationLine = 320 + 80 = 400, exactly tops[1]'s top: the boundary
    // includes it rather than staying on the earlier heading.
    expect(activeHeadingIndex(tops, 320, 800, 2000)).toBe(1);
    // One pixel short of the line, the earlier heading is still active.
    expect(activeHeadingIndex(tops, 319, 800, 2000)).toBe(0);
  });

  it('activates the last heading when scrolled to the bottom, even far past the activation line', () => {
    const tops = [100, 200, 10000];
    // scrollY + viewportHeight === documentHeight: at the bottom. The last
    // heading's top (10000) is far below where the activation line sits
    // (9480), which is exactly the case the last few TOC entries could never
    // reach under the old band-based observer.
    expect(activeHeadingIndex(tops, 9400, 800, 10200)).toBe(2);
  });

  it('does not treat a document shorter than the viewport as scrolled to the bottom', () => {
    const tops = [50, 300];
    // documentHeight < viewportHeight: the page cannot scroll at all, so
    // scrollY + viewportHeight >= documentHeight is trivially true and must
    // not trigger the bottom special case. It should still resolve by
    // position, landing on the first heading.
    expect(activeHeadingIndex(tops, 0, 800, 600)).toBe(0);
  });
});
