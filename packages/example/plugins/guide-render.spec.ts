import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type GuideFile,
  renderGuide,
  renderNav,
  renderToc,
  rewriteRepoLinks,
  slugify,
  styleAlerts,
} from './guide-render';

const GUIDE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/guide',
);

/** The eight published files, in the order the plugin concatenates them. */
async function readRealGuide(): Promise<GuideFile[]> {
  const names = (await readdir(GUIDE_DIR))
    .filter((name) => /^\d{2}-.*\.md$/.test(name))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      source: await readFile(join(GUIDE_DIR, name), 'utf8'),
    })),
  );
}

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
    // The eight files render into ONE page, so a cross-file link that stayed a
    // file link would leave the site and land on GitHub.
    const html = '<a href="07-limitations.md#nul-byte">limitations</a>';

    expect(rewriteRepoLinks(html)).toContain('href="#nul-byte"');
  });

  it("anchors a bare sibling link to that file's H1 id", () => {
    // Not a slug of the filename. Every guide title coincides with its
    // filename today, so this case is held open by a fixture rather than by
    // the real guide: `03-the-matching-line.md` was titled "The matching line,
    // and where the matches are in it" until the API rewrite shortened it, and
    // the filename version pointed at nothing for as long as it was.
    const html = '<a href="03-the-matching-line.md">The matching line</a>';
    const h1Ids = new Map([
      [
        '03-the-matching-line.md',
        'the-matching-line-and-where-the-matches-are-in-it',
      ],
    ]);

    expect(rewriteRepoLinks(html, h1Ids)).toContain(
      'href="#the-matching-line-and-where-the-matches-are-in-it"',
    );
  });

  it('falls back to the filename slug when the target has no H1', () => {
    const html = '<a href="02-searching.md">Searching</a>';

    expect(rewriteRepoLinks(html, new Map())).toContain('href="#searching"');
  });

  it('leaves an href inside a code block alone', () => {
    // A fence showing example markup must survive as written. Shiki often
    // splits such text across spans so it escapes by accident; a `text` fence
    // does not, and this is the case that used to be silently rewritten.
    const html = '<pre><code>href="02-searching.md"</code></pre>';

    expect(rewriteRepoLinks(html)).toBe(html);
  });
});

describe('styleAlerts', () => {
  it('renders a NOTE alert', () => {
    const html = styleAlerts(
      '<blockquote>\n<p>[!NOTE]<br>\nSee below.</p>\n</blockquote>',
    );

    expect(html).toContain('class="alert alert-note"');
    expect(html).toContain('>Note<');
  });

  it('renders a CAUTION alert', () => {
    const html = styleAlerts(
      '<blockquote>\n<p>[!CAUTION]<br>\nThis can lose data.</p>\n</blockquote>',
    );

    expect(html).toContain('class="alert alert-caution"');
    expect(html).toContain('>Caution<');
  });
});

describe('renderGuide', () => {
  it('gives every heading an id, so the TOC can link to it', async () => {
    const { html } = await renderGuide([
      { name: '01-caching.md', source: '# Caching\n\n## When it fills\n' },
    ]);

    expect(html).toContain('id="caching"');
    expect(html).toContain('id="when-it-fills"');
  });

  it('collects h2 and h3 into the TOC, and nothing else', async () => {
    const { toc } = await renderGuide([
      {
        name: '01-patterns.md',
        source: '# Patterns\n\n## Smart case\n\n### Details\n\n#### Ignored\n',
      },
    ]);

    expect(toc).toEqual([
      { id: 'smart-case', text: 'Smart case', level: 2 },
      { id: 'details', text: 'Details', level: 3 },
    ]);
  });

  it('de-duplicates ids across concatenated files', async () => {
    const { html } = await renderGuide([
      { name: '01-a.md', source: '## Notes\n' },
      { name: '02-b.md', source: '## Notes\n' },
    ]);

    expect(html).toContain('id="notes"');
    expect(html).toContain('id="notes-2"');
  });

  it('highlights code fences at build time', async () => {
    const { html } = await renderGuide([
      {
        name: '01-x.md',
        source:
          "# X\n\n```ts\nconst found = await matches(url, 'error');\n```\n",
      },
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
      {
        name: '01-x.md',
        source: '# X\n\n> [!WARNING]\n> Batch results never reject.\n',
      },
    ]);

    expect(html).toContain('class="alert alert-warning"');
    expect(html).toContain('Warning');
    expect(html).not.toContain('[!WARNING]');
  });

  it('renders a tip alert too', async () => {
    const { html } = await renderGuide([
      { name: '01-x.md', source: '# X\n\n> [!TIP]\n> Upgrading?\n' },
    ]);

    expect(html).toContain('class="alert alert-tip"');
  });

  it('yields to a raw anchor whose id the heading would collide with', async () => {
    // This is the real shape of 07-limitations.md: a generated anchor whose id
    // is the caveat's, followed by a heading whose title slugifies to the
    // same string. Two elements with one id is invalid HTML, and the anchor is
    // the one the README's published links point at.
    const { html } = await renderGuide([
      {
        name: '07-limitations.md',
        source: '<a id="no-ranking"></a>\n\n### No ranking\n',
      },
    ]);

    expect(html).toContain('<a id="no-ranking"></a>');
    expect(html).toContain('<h3 id="no-ranking-2">');
  });

  it('leaves no dead anchor anywhere in the real guide', async () => {
    // The whole guide, from disk, not a fixture: this is the check that catches
    // a cross-reference pointing at an id nothing emits. One such link shipped —
    // `03-the-matching-line.md` resolved to a slug of its filename while its
    // heading carried the slug of its much longer title.
    const { html } = await renderGuide(await readRealGuide());

    const ids = new Set(
      [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id),
    );
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);

    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((id) => !ids.has(id))).toEqual([]);
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
  it('marks Docs as the current page for styling and for screen readers', () => {
    expect(renderNav('docs', '/')).toContain('aria-current="page"');
  });

  it('marks nothing as current on the demo page', () => {
    expect(renderNav('demo', '/')).not.toContain('aria-current');
  });

  it('has no Demo link: the wordmark is the way home', () => {
    expect(renderNav('docs', '/')).not.toContain('>Demo<');
  });

  it('composes hrefs from the configured base', () => {
    expect(renderNav('demo', '/')).toContain('href="/docs/"');
    // The wordmark, which is the only thing pointing at the demo.
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
