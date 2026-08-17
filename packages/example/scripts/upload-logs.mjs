// Uploads the generated corpus to the R2 bucket the production demo reads,
// gzipping each file on the way. Run it after `build-logs.mjs`, from
// packages/example:
//
//     node scripts/upload-logs.mjs [--force] [--dry-run]
//
// Needs `wrangler` on PATH and CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in
// the environment.
//
// WHY THE CORPUS IS NOT IN THE SITE BUILD: the four files come to ~429 MB, and
// Cloudflare Pages caps a single asset at 25 MiB, so three of them cannot be a
// Pages asset at all. GitHub Pages could hold them and did, but it pins
// `Cache-Control: max-age=600` and cannot be told otherwise, which left most
// visitors fetching a cold object — measured at 5.5 s to first byte on the
// 252 MB source against 0.07 s warm. See
// docs/decisions/0017-example-as-hosted-demo.md.
//
// EACH OBJECT KEEPS ITS `.txt` NAME. The body is gzipped and `Content-Encoding`
// says so, which is what lets one URL serve both — a `.gz` key would force the
// page to know which form it was fetching.
//
// The keys live under `v<corpusVersion>/` because they are served `immutable`
// for a year. Nothing here bumps that version: `build-logs.mjs --check` fails
// when the seeds no longer match `corpusHash`, and bumping is a deliberate edit.

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const logsDir = join(root, '.logs');
const gzipDir = join(root, '.logs-gz');
const manifestPath = join(logsDir, 'manifest.json');

const config = JSON.parse(
  await readFile(join(root, 'logs.config.json'), 'utf8'),
);
const { sources, corpusVersion } = config;

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

const BUCKET = process.env.R2_BUCKET ?? 'netgrep-logs';
const prefix = `v${corpusVersion}`;

/** A year, `immutable`: safe only because the prefix carries the version. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

function run(args) {
  if (dryRun) {
    // Quoted for copy-paste: `spawn` takes an array, so the real call is
    // unaffected, but `text/plain; charset=utf-8` printed bare would break in a
    // shell in a way that looks like this script's fault.
    const shown = args
      .map((arg) => (/[\s;]/.test(arg) ? `'${arg}'` : arg))
      .join(' ');
    console.log(`  would run: wrangler ${shown}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn('wrangler', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`wrangler ${args[0]} exited ${code}`)),
    );
  });
}

/**
 * Gzip `src` to `dest`, skipping the work when `dest` is already newer than its
 * input — re-compressing 429 MB on every invocation is minutes of nothing.
 */
async function gzipOnce(src, dest) {
  if (!force && existsSync(dest)) {
    const [a, b] = await Promise.all([stat(src), stat(dest)]);
    if (b.mtimeMs >= a.mtimeMs) {
      console.log(`  gzip cached (${(b.size / 1e6).toFixed(1)} MB)`);
      return b.size;
    }
  }

  await pipeline(
    createReadStream(src),
    createGzip({ level: 9 }),
    createWriteStream(dest),
  );

  const { size } = await stat(dest);
  console.log(`  gzipped to ${(size / 1e6).toFixed(1)} MB`);
  return size;
}

async function put(key, file, contentType, contentEncoding) {
  const args = [
    'r2',
    'object',
    'put',
    `${BUCKET}/${key}`,
    '--file',
    file,
    '--content-type',
    contentType,
    '--cache-control',
    CACHE_CONTROL,
    '--remote',
  ];

  if (contentEncoding) args.push('--content-encoding', contentEncoding);

  await run(args);
}

if (!existsSync(logsDir)) {
  console.error(
    `no corpus at ${logsDir} — run \`pnpm logs\` first, this script only uploads.`,
  );
  process.exit(1);
}

await mkdir(gzipDir, { recursive: true });

console.log(`uploading to ${BUCKET}/${prefix}/ ${dryRun ? '(dry run)' : ''}`);

for (const source of sources) {
  const src = join(logsDir, source.file);
  if (!existsSync(src)) {
    console.error(`✗ ${source.file}: missing — run \`pnpm logs\``);
    process.exit(1);
  }

  console.log(`${source.file}:`);
  const gz = join(gzipDir, `${source.file}.gz`);
  await gzipOnce(src, gz);
  await put(
    `${prefix}/${source.file}`,
    gz,
    'text/plain; charset=utf-8',
    'gzip',
  );
}

// Uploaded last, and uncompressed: it is a few hundred bytes, and the page
// treats it as optional, so a half-finished run should not leave sizes
// describing objects that are not there yet.
if (!existsSync(manifestPath)) {
  console.error('✗ manifest.json: missing — run `pnpm logs`');
  process.exit(1);
}

console.log('manifest.json:');
await put(`${prefix}/manifest.json`, manifestPath, 'application/json', null);

console.log(`\ndone. Verify with:\n  node scripts/verify-logs.mjs`);
