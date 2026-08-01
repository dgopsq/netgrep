#!/usr/bin/env node
/**
 * Renders `docs/guide/caveats.data.json` onto the two surfaces that carry a
 * limitation, so that fixing a defect is one edit rather than two.
 *
 *   pnpm docs:sync           write the outputs
 *   pnpm docs:sync --check   write nothing; exit 1 if any output is stale
 *
 * The `--check` mode runs in CI. Without it this is just a convention, and
 * AGENTS.md §2.3 has a long history of conventions that were not kept.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderGuideSection,
  renderReadmeList,
  spliceReadme,
} from './lib/caveats.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const check = process.argv.includes('--check');

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
