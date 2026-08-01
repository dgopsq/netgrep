#!/usr/bin/env node
/**
 * Renders `docs/guide/caveats.data.json` onto the three surfaces that carry a
 * limitation, so that fixing a defect is one edit rather than three.
 *
 *   pnpm docs:sync           write the outputs
 *   pnpm docs:sync --check   write nothing; exit 1 if any output is stale
 *
 * The `--check` mode runs in CI. Without it this is just a convention, and
 * AGENTS.md §2.3 has a long history of conventions that were not kept.
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderCaveatsModule,
  renderGuideSection,
  renderReadmeList,
} from './lib/caveats.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '<!-- BEGIN GENERATED CAVEATS -->';
const END = '<!-- END GENERATED CAVEATS -->';

const check = process.argv.includes('--check');

/**
 * Biome owns the formatting of everything it lints, so a generator that emits
 * nearly-formatted TypeScript would fail `pnpm lint:js` on a trailing comma it
 * guessed wrong. Handing the output to Biome removes the guessing — and
 * `--check` compares post-format, so the two modes cannot disagree.
 */
function biomeFormat(source, filePath) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'biome', 'format', `--stdin-file-path=${filePath}`],
    { cwd: ROOT, input: source, encoding: 'utf8' },
  );

  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error(`biome format failed for ${filePath}`);
  }

  return result.stdout;
}

function spliceReadme(readme, block) {
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);

  if (start === -1 || end === -1) {
    throw new Error(
      `README.md is missing the ${BEGIN} / ${END} markers. Restore them; the caveat list is generated.`,
    );
  }

  return `${readme.slice(0, start)}${BEGIN}\n${block}\n${readme.slice(end)}`;
}

const caveats = JSON.parse(
  await readFile(join(ROOT, 'docs/guide/caveats.data.json'), 'utf8'),
);

const readme = await readFile(join(ROOT, 'README.md'), 'utf8');

const outputs = [
  {
    path: 'docs/guide/07-limitations.md',
    content: renderGuideSection(caveats),
  },
  {
    path: 'packages/example/src/data/caveats.generated.ts',
    content: biomeFormat(
      renderCaveatsModule(caveats),
      'packages/example/src/data/caveats.generated.ts',
    ),
  },
  {
    path: 'README.md',
    content: spliceReadme(readme, renderReadmeList(caveats)),
  },
];

const stale = [];

for (const output of outputs) {
  const full = join(ROOT, output.path);
  const current = await readFile(full, 'utf8').catch(() => null);

  if (current === output.content) continue;

  if (check) {
    stale.push(output.path);
    continue;
  }

  await writeFile(full, output.content);
  console.log(`wrote ${output.path}`);
}

if (stale.length > 0) {
  console.error(
    `::error::Stale generated docs: ${stale.join(', ')}. Run \`pnpm docs:sync\` and commit the result.`,
  );
  process.exit(1);
}

if (check) console.log('generated docs are up to date');
