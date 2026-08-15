import type { NetgrepHit } from '@netgrep/netgrep';
import { grep } from '@netgrep/netgrep';
import { useEffect, useState } from 'react';
import { HitBuffer } from '@/lib/hit-buffer';

/**
 * How much of each matching line the demo asks for, well under the library's
 * 4096 default.
 *
 * A row is one clipped line, so anything past this is copied out of WebAssembly
 * only to be hidden by CSS — tens of megabytes at 100,000 retained lines. The
 * longest line across all four seeds is 387 bytes, so 512 clips nothing shown.
 */
export const MAX_LINE_BYTES = 512;

export type GrepStreamState = {
  /**
   * The retained matching lines, in file order.
   *
   * ⚠️ STABLE IDENTITY, MUTATED IN PLACE — the live `HitBuffer` array, handed
   * out by reference. `retained` is what changes when it grows; copying it per
   * frame would reintroduce the cost the buffer exists to avoid. Nothing may
   * sort, splice or otherwise write to it.
   */
  hits: NetgrepHit[];
  /** `hits.length` — and the virtualizer's item count. */
  retained: number;
  /** Every matching line found, including those past the retention ceiling. */
  total: number;
  /** `total > retained`: the page is showing fewer lines than it found. */
  truncated: boolean;
  /**
   * Bytes of the file delivered to the search so far.
   *
   * ⚠️ DECOMPRESSED FILE CONTENT, NOT BYTES ON THE WIRE — the logs are served
   * gzipped at ~16×, so the transfer behind this was a fraction of it. Anything
   * rendering it must name it as file content read.
   */
  bytesRead: number;
  /**
   * Milliseconds from the run's start to the first bytes of the file arriving.
   *
   * ⚠️ THE HOST'S NUMBER, NOT THE ENGINE'S — on a cold CDN object it is seconds
   * on the large files, and left inside `firstMatchMs` it reads as the engine
   * being slow to start.
   *
   * Measured at the first `onProgress`, so it carries one chunk's transfer with
   * it: a ceiling on time-to-first-byte, not the bare handshake.
   */
  firstByteMs: number | null;
  /** Milliseconds from the run's start to its first matching line. */
  firstMatchMs: number | null;
  /** Milliseconds since the run started; frozen when it ends. */
  elapsedMs: number;
  running: boolean;
  /**
   * Whatever ended the run, in its own words. `grep` throws from the iteration,
   * so an uncompilable pattern arrives here as regex-crate prose, and so do a
   * dead host and a dropped connection.
   */
  error: string | null;
  /**
   * Whether `error` arrived AFTER hits had already been yielded.
   *
   * A connection dropping at 180 MB gives every hit up to that point and then
   * throws, and those hits are correct for the bytes read — so the feed is kept
   * and the banner says the results are partial.
   */
  partial: boolean;
};

function idleState(): GrepStreamState {
  return {
    hits: [],
    retained: 0,
    total: 0,
    truncated: false,
    bytesRead: 0,
    firstByteMs: null,
    firstMatchMs: null,
    elapsedMs: 0,
    running: false,
    error: null,
    partial: false,
  };
}

/**
 * Grep one remote log and report the run as it happens.
 *
 * THE PAGE MEASURES THE NETWORK: every figure here is the cost of actually
 * fetching a file, and it is the page's only evidence for its claim. Do not add
 * a layer that answers a repeat query from memory.
 *
 * EVERY RUN READS THE WHOLE FILE — no `break`, no early exit, because `grep`
 * yields every matching line and the last cannot be known before the last byte.
 * A query matching nothing costs what a query matching everything costs.
 *
 * ⚠️ HITS ACCUMULATE IN A CLOSURE AND PUBLISH ONCE PER ANIMATION FRAME. A
 * `setState` per hit is 100,000 renders on a loose pattern and takes the tab
 * down, virtualized or not. The cadence relies on `grep` awaiting a read per
 * network chunk; if it ever buffered whole responses this would need a worker.
 */
export function useGrepStream(url: string, pattern: string): GrepStreamState {
  const [state, setState] = useState<GrepStreamState>(idleState);

  useEffect(() => {
    if (!pattern) {
      setState(idleState());
      return;
    }

    const controller = new AbortController();
    const buffer = new HitBuffer();
    const startedAt = performance.now();

    let bytesRead = 0;
    let firstByteMs: number | null = null;
    let firstMatchMs: number | null = null;
    let elapsedMs = 0;
    let error: string | null = null;
    let partial = false;
    let done = false;
    let frame = 0;

    const publish = () => {
      frame = 0;
      if (!done) elapsedMs = performance.now() - startedAt;

      setState({
        hits: buffer.hits,
        retained: buffer.retained,
        total: buffer.total,
        truncated: buffer.truncated,
        bytesRead,
        firstByteMs,
        firstMatchMs,
        elapsedMs,
        running: !done,
        error,
        partial,
      });
    };

    /** Coalesce every hit and every chunk in this frame into one render. */
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(publish);
    };

    // Paint the empty running state at once, rather than sitting on the last
    // run's results until the first frame with a hit in it.
    publish();

    void (async () => {
      try {
        for await (const hit of grep(url, pattern, {
          fetch: { signal: controller.signal },
          maxLineBytes: MAX_LINE_BYTES,
          onProgress: (read) => {
            // First call, so the wait that precedes it is the host's.
            if (firstByteMs === null)
              firstByteMs = performance.now() - startedAt;
            bytesRead = read;
            schedule();
          },
        })) {
          if (firstMatchMs === null)
            firstMatchMs = performance.now() - startedAt;
          buffer.push(hit);
          schedule();
        }
      } catch (cause) {
        // A superseded query. Publishing this would show a failure the visitor
        // never asked for.
        if (controller.signal.aborted) return;

        error = cause instanceof Error ? cause.message : String(cause);
        // Hits already yielded are correct for the bytes that were read.
        partial = buffer.total > 0;
      }

      done = true;
      elapsedMs = performance.now() - startedAt;

      // Synchronous rather than scheduled: a run ending in a backgrounded tab
      // gets no more frames, and would sit on `running: true` forever.
      if (frame !== 0) cancelAnimationFrame(frame);
      publish();
    })();

    return () => {
      controller.abort();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [url, pattern]);

  return state;
}
