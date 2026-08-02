// Tiles each seed in seeds/ into a large synthetic log under public/logs/, so
// the demo has something worth downloading over HTTP instead of a corpus that
// finishes before a progress bar could mean anything.
//
// The seeds themselves are committed (see seeds/NOTICE.md for their licence);
// the output of this script is not — it is gitignored and can run into the
// hundreds of megabytes. Run it with:
//
//     node scripts/build-logs.mjs [--check]
//
// `--check` verifies each output exists and is already at its target size,
// writing nothing, and exits 1 on the first mismatch — for CI to fail fast
// rather than silently searching a stale or half-built corpus.
//
// Every seed MUST end with a newline: copies are concatenated back to back,
// and a seed without a trailing terminator would join its last line to the
// next copy's first, inventing a log line that exists in no real system.

import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const seedsDir = join(root, 'seeds');
const outDir = join(root, 'public', 'logs');

const { sources } = JSON.parse(
  await readFile(join(root, 'logs.config.json'), 'utf8'),
);

const checkOnly = process.argv.includes('--check');

/**
 * A marker line in the target service's own format, injected at roughly
 * `pct`% of the target size so a visitor can tell a match near the head of
 * the file from one buried near the tail. The `NETGREP-MARKER-<pct>` token
 * is what makes it a needle: nothing else in the corpus produces that text.
 */
function markerLine(id, pct) {
  const text = `NETGREP-MARKER-${pct} unique needle for the demo`;

  switch (id) {
    case 'apache':
      return `[Thu Jun 09 06:07:04 2005] [notice] ${text}\n`;
    case 'zookeeper':
      return `2015-07-29 17:41:41,536 - INFO  [main:NetgrepMarker@1] - ${text}\n`;
    case 'hadoop':
      return `2015-10-17 21:48:16,337 INFO [main] org.apache.hadoop.netgrep.Marker: ${text}\n`;
    case 'openssh':
      return `Dec 10 07:12:03 LabSZ sshd[31337]: ${text}\n`;
    default:
      throw new Error(`no marker format registered for source "${id}"`);
  }
}

/** Write `buf` to `stream`, waiting on `drain` when the internal buffer is full. */
async function write(stream, buf) {
  if (!stream.write(buf)) await once(stream, 'drain');
}

async function checkSource(source) {
  const outPath = join(outDir, source.file);

  if (!existsSync(outPath)) {
    console.error(`✗ ${source.file}: missing`);
    return false;
  }

  const { size } = await stat(outPath);
  if (size < source.targetBytes) {
    console.error(
      `✗ ${source.file}: ${size} bytes, below target ${source.targetBytes}`,
    );
    return false;
  }

  console.log(`✓ ${source.file}: ${size} bytes`);
  return true;
}

async function buildSource(source) {
  const seedPath = join(seedsDir, source.seed);
  const outPath = join(outDir, source.file);
  const target = source.targetBytes;

  if (existsSync(outPath)) {
    const { size } = await stat(outPath);
    if (size >= target) {
      console.log(`skip ${source.file} — already ${size} bytes >= target`);
      return;
    }
  }

  const seed = await readFile(seedPath);
  if (seed.length === 0 || seed.at(-1) !== 0x0a) {
    throw new Error(
      `seed ${source.seed} does not end with a newline — fix the seed, not this script`,
    );
  }

  const start = performance.now();
  // Absolute byte offsets, in ascending order, at which to inject a marker.
  const thresholds = [0.25, 0.5, 0.75, 0.99].map((f) => Math.floor(target * f));
  const pcts = [25, 50, 75, 99];
  let nextMarker = 0;
  let written = 0;

  const stream = createWriteStream(outPath);

  // Whole seeds only: each iteration appends one full copy, then checks
  // whether that copy crossed a marker threshold, then whether it reached
  // the target. Never a partial seed, so the file never truncates mid-line.
  while (true) {
    await write(stream, seed);
    written += seed.length;

    while (
      nextMarker < thresholds.length &&
      written >= thresholds[nextMarker]
    ) {
      const marker = markerLine(source.id, pcts[nextMarker]);
      await write(stream, Buffer.from(marker, 'utf8'));
      written += Buffer.byteLength(marker);
      console.log(
        `  marker ${pcts[nextMarker]}% at byte ${written - Buffer.byteLength(marker)}: ${marker.trimEnd()}`,
      );
      nextMarker += 1;
    }

    if (written >= target) break;
  }

  await new Promise((resolve, reject) => {
    stream.end((err) => (err ? reject(err) : resolve()));
  });

  const elapsedMs = performance.now() - start;
  console.log(`${source.file}: ${written} bytes in ${elapsedMs.toFixed(0)}ms`);
}

if (checkOnly) {
  const results = await Promise.all(sources.map(checkSource));
  if (results.some((ok) => !ok)) process.exit(1);
} else {
  await mkdir(outDir, { recursive: true });
  for (const source of sources) {
    await buildSource(source);
  }
}
