import { describe, expect, it } from 'vitest';
import { CAVEATS } from './caveats.generated';
import { VISIBLE } from './visible-caveats';

describe('VISIBLE', () => {
  it('renders exactly three cards, in this order', () => {
    // A bare length check would pass if any caveat were swapped for any
    // other; pinning the ids in order catches that a specific mistake
    // wouldn't: reordering, dropping, or substituting an entry.
    expect(VISIBLE.map((caveat) => caveat.id)).toEqual([
      'nul-byte',
      'no-ranking',
      'cache-off',
    ]);
  });

  it('keeps "No ranking" because it is by-design, not because the corpus can trigger it', () => {
    const source = CAVEATS.find((caveat) => caveat.id === 'no-ranking');

    expect(source?.kind).toBe('by-design');
    expect(source?.demoCorpusCanTrigger).toBe(false);
    expect(VISIBLE.some((caveat) => caveat.id === 'no-ranking')).toBe(true);
  });

  it('keeps the NUL-byte defect because the demo corpus can trigger it', () => {
    const source = CAVEATS.find((caveat) => caveat.id === 'nul-byte');

    expect(source?.kind).toBe('defect');
    expect(source?.demoCorpusCanTrigger).toBe(true);
    expect(VISIBLE.some((caveat) => caveat.id === 'nul-byte')).toBe(true);
  });

  it('excludes the CRLF and 64 KB defects, unreachable by this corpus', () => {
    const ids = VISIBLE.map((caveat) => caveat.id);

    expect(ids).not.toContain('crlf-dollar');
    expect(ids).not.toContain('long-lines');
  });

  it('includes the cache-off entry, which is demo-scoped rather than a library caveat', () => {
    expect(VISIBLE.some((caveat) => caveat.id === 'cache-off')).toBe(true);
    // The defining property: it must not be sourced from CAVEATS at all, so
    // a future edit can never fold it into the shared data file undetected.
    expect(CAVEATS.some((caveat) => caveat.id === 'cache-off')).toBe(false);
  });

  it('gives every card a non-empty, backtick-free demoBody', () => {
    // demoBody renders into a <dd> as plain text; a backtick surviving there
    // would show up literally, since nothing interprets markdown for it.
    for (const caveat of VISIBLE) {
      expect(caveat.demoBody.length).toBeGreaterThan(0);
      expect(caveat.demoBody).not.toContain('`');
    }
  });
});
