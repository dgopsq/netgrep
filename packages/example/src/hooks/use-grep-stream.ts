import type { NetgrepHit } from '@netgrep/netgrep';
import { grep } from '@netgrep/netgrep';
import { useEffect, useState } from 'react';
import { HitBuffer } from '@/lib/hit-buffer';

/**
 * How much of each matching line the demo asks for.
 *
 * Well under the library's 4096 default. A row is one clipped line of
 * monospace, so anything past this is copied out of WebAssembly only to be
 * hidden by CSS — and at up to 100,000 retained lines that waste is measured in
 * tens of megabytes rather than in bytes. The longest line across all four
 * seeds is 387 bytes (ZooKeeper), so 512 clips nothing the page would show.
 */
export const MAX_LINE_BYTES = 512;

export type GrepStreamState = {
  /**
   * The retained matching lines, in file order.
   *
   * ⚠️ STABLE IDENTITY, MUTATED IN PLACE. This is the live `HitBuffer` array,
   * handed out by reference; `retained` is what changes when it grows. React
   * re-renders on the number and the virtualizer reads the array, so copying it
   * per frame would reintroduce exactly the cost the buffer exists to avoid.
   * Nothing may sort, splice or otherwise write to it.
   */
  hits: NetgrepHit[];
  /** `hits.length` — and the virtualizer's item count. */
  retained: number;
  /** Every matching line found, including those past the retention ceiling. */
  total: number;
  /** `total > retained`: the page is showing fewer lines than it found. */
  truncated: boolean;
  /**
   * Bytes of the file delivered to the search so far, from
   * `GrepOptions.onProgress`.
   *
   * ⚠️ DECOMPRESSED FILE CONTENT, NOT BYTES ON THE WIRE. The logs are served
   * gzipped at roughly 16×, so the transfer behind this figure was a fraction
   * of it. Anything rendering it must name it as file content read.
   */
  bytesRead: number;
  /** Milliseconds from the run's start to its first matching line. */
  firstMatchMs: number | null;
  /** Milliseconds since the run started; frozen when it ends. */
  elapsedMs: number;
  running: boolean;
  /**
   * Whatever ended the run, in its own words. `grep` throws from the iteration
   * rather than folding a failure into a result, so a pattern that will not
   * compile arrives here as regex-crate prose, and so do a dead host and a
   * dropped connection.
   */
  error: string | null;
  /**
   * Whether `error` arrived AFTER hits had already been yielded.
   *
   * `grep` is explicit that it can: a connection dropping at 180 MB gives every
   * hit up to that point and then throws, and those hits are correct and
   * complete for the bytes that were read. So the feed is kept and the banner
   * says the results are partial. Blanking 40,000 true lines because the
   * 40,001st read failed would be both wrong and a worse demonstration.
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
 * THE PAGE MEASURES THE NETWORK. Every figure here is the cost of actually
 * fetching a file: netgrep retains nothing between reads and there is no cache
 * in the library to switch off, so what a repeat query costs is whatever the
 * host's response headers say — the browser's business, and visible in
 * devtools. Do not add a layer here that answers a repeat from memory; the
 * numbers are the page's only evidence for its claim.
 *
 * UNLIKE THE DASHBOARD THIS REPLACED, EVERY RUN READS THE WHOLE FILE. There is
 * no `break` out of the loop and no early exit, because enumeration is the
 * subject: `grep` yields every matching line, and the last one cannot be known
 * before the last byte. A query that matches nothing therefore costs exactly
 * what a query that matches everything costs, which is a simplification the old
 * page could not make and which several comments elsewhere were written against.
 *
 * ⚠️ HITS ARE ACCUMULATED IN A CLOSURE AND PUBLISHED ONCE PER ANIMATION FRAME.
 * This is not a micro-optimisation. A `setState` per hit is 100,000 renders on
 * a loose pattern and takes the tab down whether or not the list is virtualized.
 *
 * The frame cadence works because `grep` yields to the event loop: its loop
 * awaits `reader.read()` once per network chunk, and within one 64 KB block the
 * decode is bounded at a few hundred hits. That is a property of the library's
 * implementation this page depends on — if `grep` ever buffered whole
 * responses, frames would stop landing and this would need a worker instead.
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

    // Paint the empty running state immediately: the field shows a spinner and
    // the previous run's rows go, rather than the page sitting on stale results
    // until the first frame with a hit in it.
    publish();

    void (async () => {
      try {
        for await (const hit of grep(url, pattern, {
          fetch: { signal: controller.signal },
          maxLineBytes: MAX_LINE_BYTES,
          onProgress: (read) => {
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
        // A superseded query: this run's abort is not news, and publishing it
        // would repaint the page with a failure the visitor never asked for.
        if (controller.signal.aborted) return;

        error = cause instanceof Error ? cause.message : String(cause);
        // Hits already yielded are correct for the bytes that were read.
        partial = buffer.total > 0;
      }

      done = true;
      elapsedMs = performance.now() - startedAt;

      // The final publish is synchronous rather than scheduled: a run that ends
      // while the tab is backgrounded gets no more frames, and the page would
      // sit on `running: true` forever.
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
