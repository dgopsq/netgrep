import { describe, expect, it } from 'vitest';
import {
  renderGuide,
  renderNav,
  renderToc,
  rewriteRepoLinks,
  slugify,
} from './guide-render';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('The matching line')).toBe('the-matching-line');
  });

  it('drops punctuation that cannot appear in a fragment', () => {
    expect(slugify('`$` does not match on CRLF files')).toBe(
      'does-not-match-on-crlf-files',
    );
  });

  it('collapses runs of separators', () => {
    expect(slugify('Batches  —  and  errors')).toBe('batches-and-errors');
  });
});

describe('rewriteRepoLinks', () => {
  it('turns a link relative to docs/guide into an absolute GitHub URL', () => {
    const html = '<a href="../decisions/0020-the-matching-line.md">0020</a>';

    expect(rewriteRepoLinks(html)).toContain(
      'https://github.com/dgopsq/netgrep/blob/main/docs/decisions/0020-the-matching-line.md',
    );
  });

  it('leaves absolute URLs alone', () => {
    const html = '<a href="https://pagefind.app/">Pagefind</a>';

    expect(rewriteRepoLinks(html)).toBe(html);
  });

  it('leaves in-page anchors alone', () => {
    const html = '<a href="#nul-byte">NUL</a>';

    expect(rewriteRepoLinks(html)).toBe(html);
  });

  it('turns a link to a sibling guide file into an in-page anchor', () => {
    // The seven files render into ONE page, so a cross-file link that stayed a
    // file link would leave the site and land on GitHub.
    const html = '<a href="07-limitations.md#nul-byte">limitations</a>';

    expect(rewriteRepoLinks(html)).toContain('href="#nul-byte"');
  });

  it("anchors a bare sibling link to that file's own heading", () => {
    const html = '<a href="02-searching.md">Searching</a>';

    expect(rewriteRepoLinks(html)).toContain('href="#searching"');
  });
});

describe('renderGuide', () => {
  it('gives every heading an id, so the TOC can link to it', async () => {
    const { html } = await renderGuide(['# Caching\n\n## When it fills\n']);

    expect(html).toContain('id="caching"');
    expect(html).toContain('id="when-it-fills"');
  });

  it('collects h2 and h3 into the TOC, and nothing else', async () => {
    const { toc } = await renderGuide([
      '# Patterns\n\n## Smart case\n\n### Details\n\n#### Ignored\n',
    ]);

    expect(toc).toEqual([
      { id: 'smart-case', text: 'Smart case', level: 2 },
      { id: 'details', text: 'Details', level: 3 },
    ]);
  });

  it('de-duplicates ids across concatenated files', async () => {
    const { html } = await renderGuide(['## Notes\n', '## Notes\n']);

    expect(html).toContain('id="notes"');
    expect(html).toContain('id="notes-2"');
  });

  it('highlights code fences at build time', async () => {
    const { html } = await renderGuide([
      '# X\n\n```ts\nconst NG = new Netgrep();\n```\n',
    ]);

    // A real colour, not a `--shiki-light` custom property: the single-theme
    // form is what renders without extra CSS. The point of the whole exercise
    // is that highlighting happened here, not in the browser.
    expect(html).toContain('<pre');
    expect(html).toContain('color:#');
    expect(html).not.toContain('--shiki-light');
    expect(html).not.toContain('```');
  });

  it('renders a GitHub alert as a styled callout', async () => {
    const { html } = await renderGuide([
      '# X\n\n> [!WARNING]\n> Batch results never reject.\n',
    ]);

    expect(html).toContain('class="alert alert-warning"');
    expect(html).toContain('Warning');
    expect(html).not.toContain('[!WARNING]');
  });

  it('renders a tip alert too', async () => {
    const { html } = await renderGuide(['# X\n\n> [!TIP]\n> Upgrading?\n']);

    expect(html).toContain('class="alert alert-tip"');
  });
});

describe('renderToc', () => {
  it('marks nesting level so the stylesheet can indent h3s', () => {
    const out = renderToc([
      { id: 'smart-case', text: 'Smart case', level: 2 },
      { id: 'details', text: 'Details', level: 3 },
    ]);

    expect(out).toContain('href="#smart-case"');
    expect(out).toContain('data-level="3"');
  });

  it('strips backticks, which a heading carries as raw markdown', () => {
    // `heading_open` reads the inline token's source text, so a heading like
    // "`$` does not match on CRLF files" arrives with its backticks intact.
    const out = renderToc([
      { id: 'crlf', text: '`$` does not match on CRLF files', level: 2 },
    ]);

    expect(out).toContain('>$ does not match on CRLF files<');
  });
});

describe('renderNav', () => {
  it('marks the current page for styling and for screen readers', () => {
    expect(renderNav('docs', '/')).toContain('aria-current="page"');
  });

  it('composes hrefs from the configured base', () => {
    expect(renderNav('demo', '/')).toContain('href="/docs/"');
    expect(renderNav('docs', '/')).toContain('href="/"');
  });

  it('honours a non-root base', () => {
    // The site sat at /netgrep/ before the custom domain, and decision 0017
    // calls the base path a real hazard: a root-relative URL silently 404s and
    // the page just looks empty. So the base is threaded in, not assumed.
    const out = renderNav('demo', '/netgrep/');

    expect(out).toContain('href="/netgrep/docs/"');
    expect(out).not.toContain('href="/docs/"');
  });
});
