import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GUIDE = join(ROOT, 'docs/guide');

/** `[text](target)` — captures the target only. */
const LINK = /\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Lines outside fenced code blocks, joined back with `\n`. A heading or a
 * real link cannot occur inside a fence — a `# ` there is a shell comment,
 * and a `[text](target)` there is illustrative, not a real link — so this is
 * the correct reading of the file, not a workaround.
 */
function stripFences(source) {
  let inFence = false;
  return source
    .split('\n')
    .filter((line) => {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join('\n');
}

const files = (await readdir(GUIDE)).filter((name) => name.endsWith('.md'));

describe('the guide', () => {
  it('has the seven hand-written files and the generated one', () => {
    expect(files.sort()).toEqual([
      '01-getting-started.md',
      '02-searching.md',
      '03-the-matching-line.md',
      '04-patterns.md',
      '05-cancelling.md',
      '06-caching.md',
      '07-limitations.md',
      '08-runtimes.md',
    ]);
  });

  it.each(files)('%s opens with a single H1', async (name) => {
    const source = await readFile(join(GUIDE, name), 'utf8');
    const h1s = stripFences(source)
      .split('\n')
      .filter((line) => /^# /.test(line));

    expect(h1s).toHaveLength(1);
  });

  it.each(files)('%s has no broken relative links', async (name) => {
    const source = stripFences(await readFile(join(GUIDE, name), 'utf8'));

    const broken = [...source.matchAll(LINK)]
      .map(([, target]) => target)
      .filter((target) => !/^(https?:|#|mailto:)/.test(target))
      .map((target) => target.split('#')[0])
      .filter((target) => target !== '')
      .filter((target) => !existsSync(resolve(GUIDE, target)));

    expect(broken).toEqual([]);
  });

  it.each(files)('%s never mentions the captureLine flag', async (name) => {
    const source = await readFile(join(GUIDE, name), 'utf8');

    // `captureLine` never shipped under that name, and the `capture` option
    // it renamed is gone entirely — `grep` always yields the line. The guide
    // describes only the current shape, with no migration notes, so neither
    // name should appear anywhere in it.
    expect(source).not.toContain('captureLine');
    expect(source).not.toContain("capture: '");
  });
});
