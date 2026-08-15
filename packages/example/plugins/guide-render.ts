/**
 * Renders docs/guide/*.md into the HTML the docs page serves.
 *
 * This runs at BUILD TIME. Neither markdown-it nor Shiki reaches the browser —
 * the whole point of pre-rendering is that a page whose subject is download
 * cost does not ship a 50 KB parser to display prose about it.
 *
 * Kept outside `src/` because it imports Node types, and
 * `packages/example/tsconfig.json` deliberately excludes them (`include:
 * ["src"]`). Same treatment as vite.config.ts.
 */

import Shiki from '@shikijs/markdown-it';
import MarkdownIt from 'markdown-it';
import { netgrepTheme } from './shiki-theme';

const REPO_BLOB = 'https://github.com/dgopsq/netgrep/blob/main';

export type TocEntry = { id: string; text: string; level: 1 | 2 | 3 };
export type RenderedGuide = { html: string; toc: TocEntry[] };
export type GuideFile = { name: string; source: string };

// Created once and reused: instantiating the Shiki plugin re-initialises its
// WASM highlighter, which is the expensive part of a render. `renderGuide` is
// called on every /docs request in dev (see the Vite plugin's
// `transformIndexHtml`), so without this a page load paid that cost again.
// Safe to apply to more than one MarkdownIt instance — `markdownItShiki`'s
// returned function only assigns `options.highlight` on the instance it is
// given, closing over a highlighter that is itself stateless across calls.
let shikiPlugin: ReturnType<typeof Shiki> | null = null;

function getShikiPlugin() {
  shikiPlugin ??= Shiki({
    // ONE theme, not a light/dark pair. The site is dark-only (see the token
    // comment in index.css), and the two-theme form emits `--shiki-light` /
    // `--shiki-dark` custom properties that render as unstyled text unless a
    // stylesheet picks one — a failure that looks like Shiki not running.
    //
    // It is defined in this repository rather than picked from Shiki's bundle
    // because every bundled theme is a rainbow, and this page has exactly one
    // accent colour.
    theme: netgrepTheme,
  });

  return shikiPlugin;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * markdown-it renders `> [!WARNING]` as an ordinary blockquote whose first
 * paragraph opens with the literal marker. Rewriting the RENDERED HTML rather
 * than the source keeps the markdown a real blockquote — which is what makes
 * the same file render as an alert on GitHub.
 */
export function styleAlerts(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/g,
    (_match, kind: string) => {
      const label = kind.charAt(0) + kind.slice(1).toLowerCase();

      return `<blockquote class="alert alert-${kind.toLowerCase()}"><p class="alert-label">${label}</p><p>`;
    },
  );
}

/**
 * Guide files link to each other and to the repo using paths relative to
 * `docs/guide/`, which is what GitHub resolves correctly when the same file is
 * read there. On the site the seven files are ONE page, so a sibling link
 * becomes an in-page anchor and everything else becomes an absolute repo URL.
 *
 * `h1Ids` maps each file's name to the id its `<h1>` was given, which is what a
 * bare sibling link has to point at.
 */
export function rewriteRepoLinks(
  html: string,
  h1Ids: ReadonlyMap<string, string> = new Map(),
): string {
  // Code blocks are skipped. This runs over rendered HTML with a regex, and a
  // fence containing a literal `href="02-searching.md"` — an example of the
  // markup this very function produces — would otherwise be rewritten inside
  // what is meant to be unmodified sample code. Shiki usually splits such text
  // across spans, so it survives by accident; a `text` fence does not.
  return html
    .split(/(<pre[\s\S]*?<\/pre>)/g)
    .map((part) => (part.startsWith('<pre') ? part : rewriteHrefs(part, h1Ids)))
    .join('');
}

function rewriteHrefs(
  html: string,
  h1Ids: ReadonlyMap<string, string>,
): string {
  return html.replace(/href="([^"]+)"/g, (match, href: string) => {
    if (/^(https?:|#|mailto:)/.test(href)) return match;

    const [path, fragment] = href.split('#');

    // A sibling guide file: `07-limitations.md`, `02-searching.md#batches`.
    if (/^\d{2}-[a-z-]+\.md$/.test(path)) {
      // A bare link resolves to the target file's H1 id, which is not the slug
      // of its filename whenever the title says more than the name does.
      // Today every guide title happens to coincide with its filename, so the
      // two agree — but "The matching line, and where the matches are in it"
      // was one of them until recently, and slugifying the name produced a
      // dead anchor. The map is what keeps the next such title resolving.
      // A file with no H1 has no id to aim at, so it keeps the filename slug —
      // wrong, but a link the reader can see is broken beats a silent one.
      const anchor =
        fragment ??
        h1Ids.get(path) ??
        slugify(path.replace(/^\d{2}-|\.md$/g, ''));

      return `href="#${anchor}"`;
    }

    const resolved = path.replace(/^\.\.\//, '');

    return `href="${REPO_BLOB}/docs/${resolved}${fragment ? `#${fragment}` : ''}"`;
  });
}

export async function renderGuide(files: GuideFile[]): Promise<RenderedGuide> {
  const toc: TocEntry[] = [];
  const seen = new Map<string, number>();

  // Filled from the ids `heading_open` actually emits, rather than re-slugified
  // here: the two would drift the moment de-duplication renamed one of them.
  const h1Ids = new Map<string, string>();
  let currentFile = '';

  // Seed with the ids already present as raw anchors in the source.
  // `07-limitations.md` emits `<a id="no-ranking"></a>` before `### No
  // ranking`, and that title slugifies to the same string — so without this
  // the document carries two elements with `id="no-ranking"`. The anchor wins,
  // because the README's published links point at it; the heading takes the
  // suffixed id and the table of contents follows it there.
  for (const { source } of files) {
    for (const [, id] of source.matchAll(/\bid="([^"]+)"/g)) {
      seen.set(id, 1);
    }
  }

  // A fresh MarkdownIt instance per call: `heading_open` below closes over
  // per-render state (`toc`, `seen`, `h1Ids`, `currentFile`), and sharing the
  // instance across renders would let one render's headings corrupt the
  // next's. Only the Shiki plugin — the expensive part — is shared.
  const md = MarkdownIt({ html: true, linkify: false, typographer: false });

  md.use(await getShikiPlugin());

  md.renderer.rules.heading_open = (tokens, index) => {
    const token = tokens[index];
    const text = tokens[index + 1].content;
    const base = slugify(text);

    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;

    // h1 included: each guide file's title is a top-level section of the one
    // page they concatenate into, so a TOC that started at h2 named none of
    // the seven sections it was listing subsections of.
    if (token.tag === 'h1' || token.tag === 'h2' || token.tag === 'h3') {
      const level = token.tag === 'h1' ? 1 : token.tag === 'h2' ? 2 : 3;
      toc.push({ id, text, level });
    }

    if (token.tag === 'h1' && !h1Ids.has(currentFile)) {
      h1Ids.set(currentFile, id);
    }

    return `<${token.tag} id="${id}">`;
  };

  const html = files
    .map(({ name, source }) => {
      currentFile = name;

      return md.render(source);
    })
    .join('\n');

  return { html: rewriteRepoLinks(styleAlerts(html), h1Ids), toc };
}

export function renderToc(toc: TocEntry[]): string {
  // Every entry names the section it sits in — the id of the nearest h1 at or
  // above it — because the full list runs past thirty entries and overflows
  // the sticky column it lives in. docs-page.ts opens the section being read and
  // the stylesheet hides the subsections of the others. An entry with no h1
  // above it names nothing, which is what keeps it visible: nothing can open
  // a section that does not exist.
  let section = '';

  const items = toc
    .map((entry) => {
      if (entry.level === 1) section = entry.id;

      return `<li data-level="${entry.level}"${section ? ` data-section="${section}"` : ''}><a href="#${entry.id}">${entry.text.replace(/`/g, '')}</a></li>`;
    })
    .join('');

  return `<nav class="toc" aria-label="On this page"><p class="toc-label">On this page</p><ul>${items}</ul></nav>`;
}

/**
 * `base` is Vite's resolved `base`, threaded in rather than assumed. It is `/`
 * today, but the site sat at `/netgrep/` before the custom domain and decision
 * 0017 records that path as a real hazard: a root-relative URL silently 404s,
 * and the page looks like a set of files that match nothing rather than a bug.
 */
export function renderNav(current: 'demo' | 'docs', base: string): string {
  // Only the Docs link can ever be current. The demo has no nav entry — the
  // wordmark beside it is the way home, and a second link to the same page was
  // one the eye had to rule out.
  const docsCurrent = current === 'docs' ? ' aria-current="page"' : '';

  // A small version of the hero's `net|grep` wordmark (see hero.tsx): one
  // gradient across the lockup span, with a primary-coloured pipe painting
  // over it, at nav size. No spaces around the pipe — the artwork has none.
  // Plain classes rather than Tailwind utilities: this HTML is generated at
  // build time, outside Tailwind's scanner, so utilities here would work in
  // dev and vanish from the production build. Styled in index.css beside
  // .site-nav.
  const mark = `<a class="site-nav-mark" href="${base}"><span class="site-nav-mark-lockup">net<span class="site-nav-mark-pipe">|</span>grep</span></a>`;

  return `<header class="site-nav">
  ${mark}
  <nav aria-label="Site">
    <a href="${base}docs/"${docsCurrent}>Docs</a>
    <a href="https://github.com/dgopsq/netgrep">GitHub</a>
    <a href="https://www.npmjs.com/package/@netgrep/netgrep">npm</a>
  </nav>
</header>`;
}
