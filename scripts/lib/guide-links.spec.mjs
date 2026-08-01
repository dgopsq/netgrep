import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GUIDE = join(ROOT, 'docs/guide');

/** `[text](target)` — captures the target only. */
const LINK = /\[[^\]]*\]\(([^)]+)\)/g;

const files = (await readdir(GUIDE)).filter((name) => name.endsWith('.md'));

describe('the guide', () => {
  it('has the six hand-written files and the generated one', () => {
    expect(files.sort()).toEqual([
      '01-getting-started.md',
      '02-searching.md',
      '03-the-matching-line.md',
      '04-patterns.md',
      '05-cancelling.md',
      '06-caching.md',
      '07-limitations.md',
    ]);
  });

  it.each(files)('%s opens with a single H1', async (name) => {
    const source = await readFile(join(GUIDE, name), 'utf8');
    const h1s = source.split('\n').filter((line) => /^# /.test(line));

    expect(h1s).toHaveLength(1);
  });

  it.each(files)('%s has no broken relative links', async (name) => {
    const source = await readFile(join(GUIDE, name), 'utf8');

    const broken = [...source.matchAll(LINK)]
      .map(([, target]) => target)
      .filter((target) => !/^(https?:|#|mailto:)/.test(target))
      .map((target) => target.split('#')[0])
      .filter((target) => target !== '')
      .filter((target) => !existsSync(resolve(GUIDE, target)));

    expect(broken).toEqual([]);
  });

  it.each(files)(
    '%s does not mention the removed captureLine flag',
    async (name) => {
      const source = await readFile(join(GUIDE, name), 'utf8');

      // `capture: 'line'` replaced `captureLine: true` with no alias. The one
      // legitimate mention is the migration note, which says "Renamed".
      if (source.includes('captureLine')) {
        expect(source).toContain('Renamed');
      }
    },
  );
});
