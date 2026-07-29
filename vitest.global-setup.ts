import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fail the browser project with an actionable message when the WASM has not
 * been built.
 *
 * This check cannot live inside the test file. `packages/search/pkg/` is a
 * gitignored build output, so on a fresh clone Vite cannot even *resolve*
 * `@netgrep/search` while transforming `Netgrep.ts` — the run dies before any
 * test module, and therefore any `vi.mock` factory, is ever evaluated. What a
 * contributor sees is `Failed to resolve import "@netgrep/search"`, which does
 * not mention the one command that fixes it.
 *
 * `globalSetup` runs in Node, ahead of the browser and ahead of Vite's
 * transform, which is early enough to say something useful.
 *
 * It is deliberately NOT applied to the unit project: that suite mocks the
 * engine outright and is documented as working on a checkout that has never
 * run `pnpm build:wasm`. See AGENTS.md §2.2.
 */
export function setup() {
  const here = dirname(fileURLToPath(import.meta.url));
  const wasmPath = resolve(here, 'packages/search/pkg/index_bg.wasm');

  if (!existsSync(wasmPath)) {
    throw new Error(
      [
        '',
        'The WASM build is missing, so the integration tests cannot run',
        'against the real engine.',
        '',
        'Build it with:  pnpm build:wasm',
        '',
        `Expected at: ${wasmPath}`,
        '',
      ].join('\n'),
    );
  }
}
