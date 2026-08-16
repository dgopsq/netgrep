import { describe, expect, it } from 'vitest';
import {
  BEGIN,
  END,
  renderGuideSection,
  renderReadmeList,
  spliceReadme,
} from './caveats.mjs';

/** Two entries, one of each `kind`. */
const CAVEATS = [
  {
    id: 'no-ranking',
    title: 'No ranking',
    short: 'netgrep does not rank, count or order matches.',
    body: 'Long prose about ranking.',
    kind: 'by-design',
    backlog: null,
  },
  {
    id: 'nul-byte',
    title: 'Binary files stop at the first NUL',
    short: 'A file containing a NUL byte reports no match.',
    body: 'Long prose about NUL bytes.',
    kind: 'defect',
    backlog: '3f',
  },
];

describe('renderGuideSection', () => {
  it('renders every entry, with the full body', () => {
    const out = renderGuideSection(CAVEATS);

    expect(out).toContain('Long prose about ranking.');
    expect(out).toContain('Long prose about NUL bytes.');
  });

  it('separates by-design entries from defects', () => {
    const out = renderGuideSection(CAVEATS);

    // The defect heading must come first: a reader scanning for bugs should
    // not have to scroll past the things that will never change.
    expect(out.indexOf('## Defects')).toBeLessThan(out.indexOf('## By design'));
  });

  it('never links the internal backlog, which a reader cannot act on', () => {
    const out = renderGuideSection(CAVEATS);

    expect(out).not.toContain('BACKLOG');
    expect(out).not.toContain('3f');
  });

  it('opens with the generated banner', () => {
    expect(renderGuideSection(CAVEATS)).toContain('pnpm docs:sync');
  });

  it('anchors each entry on its id, not a slug of its title', () => {
    const out = renderGuideSection(CAVEATS);

    expect(out).toContain('<a id="nul-byte"></a>');
    expect(out).toContain('<a id="no-ranking"></a>');
  });
});

describe('renderReadmeList', () => {
  it('lists defects only', () => {
    const out = renderReadmeList(CAVEATS);

    expect(out).toContain('Binary files stop at the first NUL');
    expect(out).not.toContain('No ranking');
  });

  it('uses the short form, never the body', () => {
    const out = renderReadmeList(CAVEATS);

    expect(out).toContain('A file containing a NUL byte reports no match.');
    expect(out).not.toContain('Long prose about NUL bytes.');
  });

  it('links each entry to its anchor on the docs site', () => {
    expect(renderReadmeList(CAVEATS)).toContain(
      'https://www.netgrep.dev/docs/#nul-byte',
    );
  });
});

describe('spliceReadme', () => {
  it('replaces the block between the markers', () => {
    const readme = `# Title\n\n${BEGIN}\nold content\n${END}\n\n## Next section\n`;

    const out = spliceReadme(readme, 'new content');

    expect(out).toBe(
      `# Title\n\n${BEGIN}\nnew content\n${END}\n\n## Next section\n`,
    );
  });

  it('is idempotent when spliced twice', () => {
    const readme = `# Title\n\n${BEGIN}\nold content\n${END}\n`;

    const once = spliceReadme(readme, 'new content');
    const twice = spliceReadme(once, 'new content');

    expect(twice).toBe(once);
  });

  it('throws when BEGIN is missing', () => {
    const readme = `# Title\n\nold content\n${END}\n`;

    expect(() => spliceReadme(readme, 'new content')).toThrow(
      /missing or has misordered/,
    );
  });

  it('throws when END is missing', () => {
    const readme = `# Title\n\n${BEGIN}\nold content\n`;

    expect(() => spliceReadme(readme, 'new content')).toThrow(
      /missing or has misordered/,
    );
  });

  it('throws when the markers are swapped', () => {
    const readme = `# Title\n\n${END}\nold content\n${BEGIN}\n`;

    expect(() => spliceReadme(readme, 'new content')).toThrow(
      /missing or has misordered/,
    );
  });
});
