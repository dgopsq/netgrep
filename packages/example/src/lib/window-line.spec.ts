import type { NetgrepMatchRange } from '@netgrep/netgrep';
import { describe, expect, it } from 'vitest';
import { HEAD_CHARS, VISIBLE_CHARS, windowLine } from './window-line';

/** What the row would actually show for each range, after windowing. */
function matchedTexts(text: string, ranges: NetgrepMatchRange[]): string[] {
  return ranges.map((range) => text.slice(range.start, range.end));
}

describe('windowLine', () => {
  it('leaves a line that already fits alone', () => {
    const line = 'short line with BREAK-IN in it';
    const ranges = [{ start: 16, end: 24 }];

    const windowed = windowLine(line, ranges);

    expect(windowed.text).toBe(line);
    expect(windowed.ranges).toEqual(ranges);
    expect(windowed.elided).toBe(false);
  });

  it('leaves a long line alone when its first match is already visible', () => {
    const line = `the BREAK-IN is early${'x'.repeat(500)}`;
    const ranges = [{ start: 4, end: 12 }];

    const windowed = windowLine(line, ranges);

    expect(windowed.text).toBe(line);
    expect(windowed.elided).toBe(false);
  });

  // The bug this module exists for: a match past the visible width rendered a
  // row with no highlight in it at all, which reads as a false positive.
  it('pulls a match past the visible width into view', () => {
    const line = `${'x'.repeat(200)}BREAK-IN${'y'.repeat(20)}`;
    const ranges = [{ start: 200, end: 208 }];

    const windowed = windowLine(line, ranges);

    expect(windowed.elided).toBe(true);
    expect(matchedTexts(windowed.text, windowed.ranges)).toEqual(['BREAK-IN']);
    // Comfortably inside any plausible viewport, which is the whole point.
    expect(windowed.ranges[0]?.start).toBeLessThan(VISIBLE_CHARS);
  });

  // A log line's head is its timestamp and level. Dropping it to show the match
  // would trade one missing piece of context for another.
  it('keeps the head of the line and marks the gap', () => {
    const line = `2016-09-28 04:30:31 INFO ${'x'.repeat(200)}BREAK-IN`;
    const ranges = [{ start: 225, end: 233 }];

    const windowed = windowLine(line, ranges);

    expect(windowed.text.startsWith(line.slice(0, HEAD_CHARS))).toBe(true);
    expect(windowed.text).toContain('…');
    expect(matchedTexts(windowed.text, windowed.ranges)).toEqual(['BREAK-IN']);
  });

  it('shows context before the match rather than starting on it', () => {
    const line = `${'x'.repeat(200)}BREAK-IN`;
    const ranges = [{ start: 200, end: 208 }];

    const windowed = windowLine(line, ranges);
    const before = windowed.text.slice(0, windowed.ranges[0]?.start);

    // Something of the line sits between the ellipsis and the match.
    expect(before.endsWith('…')).toBe(false);
    expect(before).toMatch(/x{2,}$/);
  });

  // Every match's offsets have to survive the shift, not just the first — the
  // row highlights all of them, and one stale offset marks the wrong text.
  it('shifts every range, not only the one it windowed around', () => {
    const line = `${'x'.repeat(200)}BREAK-IN and again BREAK-IN`;
    const ranges = [
      { start: 200, end: 208 },
      { start: 219, end: 227 },
    ];

    const windowed = windowLine(line, ranges);

    expect(matchedTexts(windowed.text, windowed.ranges)).toEqual([
      'BREAK-IN',
      'BREAK-IN',
    ]);
  });

  // `ranges` is empty when every match sat past the library's byte cap. There
  // is nothing to centre on, so there is nothing to gain by cutting the line.
  it('leaves a line with no ranges alone', () => {
    const line = 'x'.repeat(500);

    const windowed = windowLine(line, []);

    expect(windowed.text).toBe(line);
    expect(windowed.elided).toBe(false);
  });
});
