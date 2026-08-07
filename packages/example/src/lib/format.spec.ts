import { describe, expect, it } from 'vitest';
import { formatThroughput } from './format';

describe('formatThroughput', () => {
  it('reports MB per second with one decimal', () => {
    // 10 MiB in 500ms → 20 MB/s
    expect(formatThroughput(10 * 1024 * 1024, 500)).toBe('20.0 MB/s');
  });

  it('drops the decimal past 100, where it is noise', () => {
    // 240 MiB in 1000ms → 240 MB/s
    expect(formatThroughput(240 * 1024 * 1024, 1000)).toBe('240 MB/s');
  });

  // A run that has read nothing has no rate, and dividing by a zero elapsed
  // prints `Infinity MB/s` on the one page whose claim is that its numbers are
  // real.
  it('has no answer before there is one', () => {
    expect(formatThroughput(0, 0)).toBe('—');
    expect(formatThroughput(1024, 0)).toBe('—');
    expect(formatThroughput(0, 1024)).toBe('—');
  });
});
