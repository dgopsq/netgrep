// Deno needs no boot module: its `fetch` reads the `file:` URL that the
// default loader builds, so the `deno` condition points at the same fetch boot
// the browser uses. This script exists to keep that true.
//
// Run with: deno run --allow-read --allow-net

// Resolved through the same `imports` map a consumer's resolver reads — this
// script sits inside `packages/netgrep`, so `#wasm-boot` here is that
// specifier. See the identity check below.
import * as boot from '#wasm-boot';
import { grep, matches } from '../dist/index.js';
import * as fetchBoot from '../dist/lib/boot/fetch.js';

const LINES = 200_000;
const out: string[] = [];

for (let i = 1; i <= LINES; i++) {
  out.push(
    i === 137
      ? `line ${i} ECONNREFUSED upstream`
      : `line ${i} ordinary padding text here`,
  );
}

out.push(`line ${LINES + 1} ECONNREFUSED again`);

const payload = `${out.join('\n')}\n`;

const server = Deno.serve(
  { port: 0, onListen: () => {} },
  () => new Response(payload, { headers: { 'content-type': 'text/plain' } }),
);

const url = `http://localhost:${server.addr.port}/log.txt`;
const failures: string[] = [];

// The three result checks below cannot see the thing this script is for. Deno
// implements `node:fs` and `import.meta.resolve` too, so if the `deno` row were
// deleted or reordered below `node`, Deno would take the NODE boot, read the
// binary off disk, and answer all three correctly. Only namespace identity
// separates "works" from "works through the boot we claim it uses".
if (boot !== fetchBoot) {
  failures.push('#wasm-boot did not resolve to the fetch boot module');
}

const seen: number[] = [];

for await (const hit of grep(url, 'ECONNREFUSED')) {
  seen.push(hit.lineNumber);
}

if (seen.join(',') !== `137,${LINES + 1}`) {
  failures.push(
    `expected line numbers 137,${LINES + 1} but got ${seen.join(',')}`,
  );
}

if ((await matches(url, 'ECONNREFUSED')) !== true) {
  failures.push('expected a true positive for ECONNREFUSED');
}

if ((await matches(url, 'NOTPRESENTANYWHERE')) !== false) {
  failures.push('expected a true negative for NOTPRESENTANYWHERE');
}

await server.shutdown();

if (failures.length > 0) {
  console.error('Deno smoke FAILED:');

  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }

  Deno.exit(1);
}

console.log('Deno smoke passed.');
