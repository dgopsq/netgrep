import { describe, expect, it } from 'vitest';
import {
  BEGIN,
  END,
  renderCaveatsModule,
  renderGuideSection,
  renderReadmeList,
  spliceReadme,
} from './caveats.mjs';

/** Two entries covering both `kind`s and both sides of the demo filter. */
const CAVEATS = [
  {
    id: 'no-ranking',
    title: 'No ranking',
    short: 'netgrep does not rank, count or order matches.',
    body: 'Long prose about ranking.',
    demoBody: 'Card copy about ranking.',
    kind: 'by-design',
    backlog: null,
    demoCorpusCanTrigger: false,
  },
  {
    id: 'nul-byte',
    title: 'Binary files stop at the first NUL',
    short: 'A file containing a NUL byte reports no match.',
    body: 'Long prose about NUL bytes.',
    demoBody: 'Card copy about NUL bytes.',
    kind: 'defect',
    backlog: '3f',
    demoCorpusCanTrigger: true,
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

  it('names the backlog item for a defect that has one', () => {
    expect(renderGuideSection(CAVEATS)).toContain('BACKLOG.md#3f');
  });

  it('opens with the generated banner', () => {
    expect(renderGuideSection(CAVEATS)).toContain('pnpm docs:sync');
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
      'https://netgrep.diegopasquali.com/docs/#nul-byte',
    );
  });
});

describe('renderCaveatsModule', () => {
  it('emits every entry, so the demo does its own filtering', () => {
    const out = renderCaveatsModule(CAVEATS);

    expect(out).toContain("id: 'no-ranking'");
    expect(out).toContain("id: 'nul-byte'");
  });

  it('omits body, which no surface in the demo renders', () => {
    expect(renderCaveatsModule(CAVEATS)).not.toContain('Long prose');
  });

  it('carries demoBody, which is what the cards render', () => {
    const out = renderCaveatsModule(CAVEATS);

    expect(out).toContain('Card copy about ranking.');
    expect(out).toContain('Card copy about NUL bytes.');
  });

  it('emits null demoBody for an entry the demo cannot show', () => {
    const hidden = { ...CAVEATS[1], id: 'crlf', demoBody: null };

    expect(renderCaveatsModule([hidden])).toContain('demoBody: null,');
  });

  it('carries the flags the demo filters on', () => {
    const out = renderCaveatsModule(CAVEATS);

    expect(out).toContain("kind: 'by-design'");
    expect(out).toContain('demoCorpusCanTrigger: true');
  });

  it('escapes a single quote in copy so the module still parses', () => {
    const out = renderCaveatsModule([
      { ...CAVEATS[1], short: "ripgrep's detection quits." },
    ]);

    expect(out).toContain("\\'");
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
