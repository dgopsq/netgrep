import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serve the generated corpus at `/logs/*` in dev, from `.logs/` rather than
 * `public/`.
 *
 * ⚠️ THE DIRECTORY IS OUTSIDE `public/` ON PURPOSE. Vite copies the whole
 * `publicDir` into `dist/`, so a corpus living there is ~429 MB added to the
 * Pages artefact on any machine that has run `pnpm dev` — files production does
 * not even read, since it fetches them from R2. Dropping the `prebuild` that
 * generates them is not enough: the copy depends on what is on disk, so the only
 * structural fix is for them not to be in `publicDir` at all.
 *
 * Dev only. Production resolves these URLs to `logs.netgrep.dev` in
 * `src/data/logs.ts`, and nothing here runs in a build.
 */
export function devLogsPlugin(): Plugin {
  const dir = resolve(import.meta.dirname, '..', '.logs');

  return {
    name: 'netgrep-dev-logs',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use('/logs', (req, res, next) => {
        // Strip any query string, and refuse anything trying to climb out of
        // the corpus directory.
        const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(
          /^\//,
          '',
        );
        const file = join(dir, name);

        if (!name || !file.startsWith(dir) || !existsSync(file)) {
          next();
          return;
        }

        const { size } = statSync(file);
        res.setHeader(
          'Content-Type',
          name.endsWith('.json')
            ? 'application/json'
            : 'text/plain; charset=utf-8',
        );
        res.setHeader('Content-Length', String(size));
        // Served uncompressed in dev, unlike R2. `bytesRead` in the page counts
        // decompressed bytes either way, so the figures stay comparable.
        createReadStream(file).pipe(res);
      });
    },
  };
}
