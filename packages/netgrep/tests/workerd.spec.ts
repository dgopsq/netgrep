import { expect, it } from 'vitest';
import { grep, matches } from '../dist/index.js';

// Any absolute URL will do: the runner Worker's `outboundService` routes every
// outbound fetch to `workerd-origin.js`, whatever the host. Keeping a
// plausible one makes the failure readable if that wiring ever comes undone.
const url = 'https://fixture.netgrep.test/log.txt';
const LINES = 200_000;

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
