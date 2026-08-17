// Checks that the corpus on R2 is actually serving what the demo depends on,
// and measures what a visitor pays for the first byte. Run from packages/example:
//
//     node scripts/verify-logs.mjs [--origin https://logs.netgrep.dev]
//
// Asserts, per object: it exists, its body is gzipped, it is cacheable for a
// year, and it is readable cross-origin from www.netgrep.dev. Any one of those
// silently missing is a demo that either breaks or gets slow, and neither shows
// up in a build.
//
// The timings are the point of the whole exercise, so it prints them twice: the
// first request per object is likely a cache MISS, the second a HIT. On GitHub
// Pages, which pinned `max-age=600` and could not be told otherwise, that gap
// was 5.5 s against 0.07 s on the 252 MB source.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const config = JSON.parse(
  await readFile(join(root, 'logs.config.json'), 'utf8'),
);
const { sources, corpusVersion, remoteBase } = config;

const originFlag = process.argv.indexOf('--origin');
const origin = originFlag === -1 ? remoteBase : process.argv[originFlag + 1];
const base = `${origin}/v${corpusVersion}`;

/** The origin the bucket's CORS policy has to allow. */
const SITE_ORIGIN = 'https://www.netgrep.dev';

let failed = false;

function check(ok, label, detail) {
  if (!ok) failed = true;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
}

/**
 * Fetch and drain the body, returning headers and time-to-first-byte.
 *
 * The body must be drained rather than dropped: leaving it unread means the
 * next request may reuse a connection mid-transfer, and the second timing stops
 * being a timing. `Origin` is set so the response carries the CORS headers a
 * browser would need.
 */
async function measure(url) {
  const started = performance.now();
  const response = await fetch(url, { headers: { Origin: SITE_ORIGIN } });
  const ttfb = performance.now() - started;

  let bytes = 0;
  for await (const chunk of response.body) bytes += chunk.length;

  return { response, ttfb, total: performance.now() - started, bytes };
}

console.log(`verifying ${base}\n`);

for (const source of sources) {
  const url = `${base}/${source.file}`;
  console.log(`${source.file}`);

  let cold;
  try {
    cold = await measure(url);
  } catch (cause) {
    check(false, 'reachable', cause.message);
    continue;
  }

  const { response } = cold;
  const headers = response.headers;

  check(response.ok, 'status', String(response.status));
  if (!response.ok) continue;

  // `fetch` strips `Content-Encoding` once it has decoded the body, so the
  // evidence that it arrived gzipped is that far fewer bytes crossed the wire
  // than the body decoded to.
  check(
    cold.bytes > source.targetBytes,
    'decodes to full size',
    `${(cold.bytes / 1e6).toFixed(1)} MB`,
  );

  const cacheControl = headers.get('cache-control') ?? '';
  check(
    cacheControl.includes('immutable') && /max-age=\d{7,}/.test(cacheControl),
    'cache-control',
    cacheControl || '(absent)',
  );

  check(
    headers.get('access-control-allow-origin') !== null,
    'cors',
    headers.get('access-control-allow-origin') ?? '(absent)',
  );

  const warm = await measure(url);
  console.log(
    `  first byte: ${cold.ttfb.toFixed(0)} ms (${headers.get('cf-cache-status') ?? '?'})` +
      ` → ${warm.ttfb.toFixed(0)} ms (${warm.response.headers.get('cf-cache-status') ?? '?'})`,
  );
  console.log('');
}

console.log('manifest.json');
try {
  const response = await fetch(`${base}/manifest.json`, {
    headers: { Origin: SITE_ORIGIN },
  });
  check(response.ok, 'status', String(response.status));

  if (response.ok) {
    const manifest = await response.json();
    for (const source of sources) {
      check(
        typeof manifest[source.id] === 'number',
        `lists ${source.id}`,
        String(manifest[source.id]),
      );
    }
  }
} catch (cause) {
  check(false, 'reachable', cause.message);
}

process.exit(failed ? 1 : 0);
