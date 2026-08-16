import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { grep, matches } from '../dist/index.js';

// Big enough to arrive in several chunks, so the block splitter is exercised
// rather than a single-read shortcut. Matches sit at the very start and the
// very end, which is what makes the line numbers meaningful.
const LINES = 200_000;

function body(): string {
  const out: string[] = [];

  for (let i = 1; i <= LINES; i++) {
    out.push(
      i === 137
        ? `line ${i} ECONNREFUSED upstream`
        : `line ${i} ordinary padding text here`,
    );
  }

  out.push(`line ${LINES + 1} ECONNREFUSED again`);

  return `${out.join('\n')}\n`;
}

let server: Server;
let url: string;

beforeAll(async () => {
  const payload = body();

  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(payload);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('the fixture server did not bind a port');
  }

  url = `http://localhost:${address.port}/log.txt`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// The line numbers are the assertion that matters: a stubbed or half-booted
// engine can return `false`, which is what made decision 0005's breakage
// invisible, but it cannot invent 137 and 200001.
it('yields every matching line with its file-absolute number', async () => {
  const seen: number[] = [];

  for await (const hit of grep(url, 'ECONNREFUSED')) {
    seen.push(hit.lineNumber);
  }

  expect(seen).toEqual([137, LINES + 1]);
});

it('answers true for a pattern that occurs', async () => {
  await expect(matches(url, 'ECONNREFUSED')).resolves.toBe(true);
});

// The true negative is not redundant with the true positive: a boot that
// never ran would answer `false` to both, and only this pair separates
// "working" from "silently answering no".
it('answers false for a pattern that does not occur', async () => {
  await expect(matches(url, 'NOTPRESENTANYWHERE')).resolves.toBe(false);
});

it('stops at the first hit when the consumer breaks', async () => {
  let first: number | undefined;

  for await (const hit of grep(url, 'ECONNREFUSED')) {
    first = hit.lineNumber;
    break;
  }

  expect(first).toBe(137);
});
