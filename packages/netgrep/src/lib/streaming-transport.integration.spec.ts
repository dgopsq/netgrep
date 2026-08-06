import { describe, expect, it } from 'vitest';
import {
  DRIP_HEAD_LINE,
  DRIP_TAIL_LINE,
} from '../../../../vitest.drip-server.js';
import { Netgrep } from './Netgrep.js';

/**
 * How long to wait before calling it: the bytes are not coming.
 *
 * Not a performance budget. The server has already written the head by the
 * time it holds the connection, so on a working platform every wait here
 * settles in milliseconds. The only thing this number decides is how long a
 * BROKEN platform takes to say so.
 */
const DEADLINE_MS = 10_000;

/**
 * Await something that must arrive while the response is still open, and fail
 * with the reason rather than a bare timeout.
 */
function beforeTheResponseEnds<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${what} never arrived. The response is still open and the rest of ` +
              'its bytes have not been sent yet, so this can only mean the ' +
              'browser buffered the body instead of delivering it as it arrived.',
          ),
        ),
      DEADLINE_MS,
    );
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** A fresh id per test, so held responses can never collide. */
function dripId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const release = (id: string) => fetch(`/__drip/release?id=${id}`);

describe('the transport delivers bytes while the response is still open', () => {
  // ⚠️ This file must NOT mock `fetch`. Every other integration test fakes the
  // network to make chunk boundaries deterministic, which means none of them
  // can say anything about the network itself — they prove netgrep consumes an
  // already-progressive stream progressively, which was never the question.
  //
  // Here a real Chromium makes a real request to a server that sends the first
  // 64 KB, then holds the connection open and sends nothing more until asked.
  // Reading a match out of those first bytes is therefore only possible if they
  // crossed while the response was unfinished. Nothing is timed; the ordering
  // is enforced by the server refusing to finish.

  it('hands the first bytes to a reader before the rest is sent', async () => {
    const id = dripId();

    const response = await beforeTheResponseEnds(
      fetch(`/__drip?id=${id}`),
      'the response headers',
    );

    expect(response.body).not.toBeNull();

    const reader = response.body?.getReader();

    if (!reader) throw new Error('the response carried no body');

    const { value, done } = await beforeTheResponseEnds(
      reader.read(),
      'the first chunk',
    );

    expect(done).toBe(false);
    expect(value?.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(value)).toContain(DRIP_HEAD_LINE);

    await reader.cancel();
    await release(id);
  }, 20_000);

  it('answers a search from bytes that arrived before the response ended', async () => {
    const id = dripId();
    const netgrep = new Netgrep();

    // Resolving at all is the assertion. The line this matches is in the head;
    // the rest of the body does not exist yet, so a buffered response could
    // never produce this answer.
    const result = await beforeTheResponseEnds(
      netgrep.search(`/__drip?id=${id}`, DRIP_HEAD_LINE, undefined, {
        capture: 'line',
      }),
      'the search result',
    );

    expect(result.result).toBe(true);
    expect(result.line).toBe(DRIP_HEAD_LINE);

    await release(id);
  }, 20_000);

  it('does not see the held-back tail until it is released', async () => {
    // The mirror of the test above, and what stops it passing for the wrong
    // reason: if the whole body were somehow already present, this search
    // would find the tail's line too.
    const id = dripId();
    const netgrep = new Netgrep();

    const search = netgrep.search(`/__drip?id=${id}`, DRIP_TAIL_LINE);

    // Give the head every chance to arrive and be searched. Nothing is being
    // waited FOR here — the point is that the search is still unresolved after
    // the head has certainly been delivered and scanned.
    const settledEarly = await Promise.race([
      search.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);

    expect(settledEarly).toBe(false);

    await release(id);

    const result = await beforeTheResponseEnds(search, 'the released result');

    expect(result.result).toBe(true);
  }, 20_000);
});
