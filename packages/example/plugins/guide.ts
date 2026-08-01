import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import {
  type GuideFile,
  renderGuide,
  renderNav,
  renderToc,
} from './guide-render';

const GUIDE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/guide',
);

async function readGuide(): Promise<GuideFile[]> {
  const names = (await readdir(GUIDE_DIR))
    .filter((name) => /^\d{2}-.*\.md$/.test(name))
    .sort();

  // The name travels with the source: a bare cross-file link is resolved
  // against the target file's heading id, which needs the filename to match on.
  return Promise.all(
    names.map(async (name) => ({
      name,
      source: await readFile(join(GUIDE_DIR, name), 'utf8'),
    })),
  );
}

export function guidePlugin(): Plugin {
  let base = '/';

  return {
    name: 'netgrep-guide',

    // Vite's resolved `base`, so renderNav composes hrefs from it rather than
    // hardcoding the root. See the comment on renderNav.
    configResolved(config) {
      base = config.base;
    },

    // The guide lives outside this package, so Vite's own watcher does not
    // see it. Without this a prose edit needs a dev-server restart.
    configureServer(server) {
      server.watcher.add(GUIDE_DIR);
      server.watcher.on('change', (path) => {
        if (path.startsWith(GUIDE_DIR)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },

    async transformIndexHtml(html, ctx) {
      const isDocs = ctx.path.startsWith('/docs');

      const withNav = html.replace(
        '<!--SITE_NAV-->',
        renderNav(isDocs ? 'docs' : 'demo', base),
      );

      if (!isDocs) return withNav;

      const { html: body, toc } = await renderGuide(await readGuide());

      return withNav
        .replace('<!--GUIDE_TOC-->', renderToc(toc))
        .replace('<!--GUIDE_BODY-->', body);
    },
  };
}
