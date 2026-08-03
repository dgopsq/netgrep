import type { NetgrepMatchRange } from '@netgrep/netgrep';
import { Netgrep } from '@netgrep/netgrep';
import { useEffect, useRef, useState } from 'react';
import { logUrl, sources } from '@/data/logs';
import { beginScanRun, installScanMeter, scannedBytes } from '@/lib/scan-meter';

/**
 * How a single source is currently rendered.
 */
export type SourceStatus =
  | 'idle'
  | 'searching'
  | 'matched'
  | 'missed'
  | 'failed';

/**
 * How much of a matching line the demo asks for.
 *
 * Well under the library's 4 KB default, because this page renders one log
 * row and anything past that is copied out of WebAssembly only to be hidden
 * by CSS. The longest line across all four seeds is 387 bytes (Zookeeper), so
 * 512 leaves headroom without asking for more than the page ever shows.
 */
const MAX_LINE_BYTES = 512;

export type MatchedLine = {
  text: string;
  ranges: NetgrepMatchRange[];
};

export type SearchState = {
  /** Status per source id. */
  statuses: Record<string, SourceStatus>;
  /**
   * The first matching line and where the pattern matches within it, per
   * source id, for sources that matched.
   *
   * Kept across runs for the same reason `statuses` is — see the
   * stale-while-revalidate note below. A panel's line is replaced when that
   * panel's own new answer arrives, not when the query changes.
   */
  lines: Record<string, MatchedLine>;
  /**
   * Whether a source's `status`, `line`, `elapsedMs` and `scanned` are still
   * last run's, per source id: true from the moment a run starts until that
   * source answers it.
   *
   * This is the price of the stale-while-revalidate design below, and it has to
   * be paid explicitly. `statuses` alone cannot tell the difference between a
   * source that matched this query and one that matched the previous one — both
   * read `matched` — so a panel drawing from it would spend the whole run
   * claiming a verdict for a pattern that is no longer in the search box. On
   * the old 2.6 MB of stories that window was a flicker; over 400 MB it is
   * nearly two seconds, which is the entire time a visitor is looking.
   */
  pending: Record<string, boolean>;
  /**
   * Milliseconds from the run's first byte requested to each source's own
   * answer, per source id. With four files running from 8 MB to 240 MB, this
   * is the number the dashboard exists to show: not just whether a source
   * matched, but how long reading it — or reading all of it, on a miss —
   * actually took.
   */
  elapsedMs: Record<string, number>;
  /**
   * Bytes of each source that reached the search before it answered, per source
   * id — the other half of what `elapsedMs` reports. A source that matches
   * early stops its download there, and this is the figure that says so: 8% of
   * one file against 100% of three.
   *
   * ⚠️ Decompressed bytes, not wire bytes. The logs are served gzipped at about
   * 16×, so anything rendering this must name it as file content read rather
   * than as bandwidth spent.
   *
   * Carried across runs and gated by `pending`, exactly as `elapsedMs` is: a
   * source that has not answered the query now in the box must not show the
   * last query's count.
   */
  scanned: Record<string, number>;
  matched: number;
  /**
   * `scanned` summed over the sources that have answered THIS run, so it grows
   * as the four settle and never carries a byte from the previous query. Zeroed
   * at the start of a run, like `matched` and `answered`.
   */
  scannedTotal: number;
  /** How many of the four sources have answered. */
  answered: number;
  /** Milliseconds from the first byte requested to the first match resolving. */
  firstMatchMs: number | null;
  /** Milliseconds until every source had an answer. */
  allAnsweredMs: number | null;
  /**
   * The engine's own diagnostic when the pattern will not compile. Since
   * `search_bytes` returns a `Result`, an unbalanced `(` arrives here as
   * regex-crate prose rather than as `RuntimeError: unreachable`.
   */
  error: string | null;
  running: boolean;
};

/**
 * THE PAGE MEASURES THE NETWORK, AND IT NOW DOES SO BY CONSTRUCTION.
 *
 * netgrep used to keep downloaded bytes in memory, on by default, and this
 * page switched it off: a miss drains the stream, which is exactly the
 * condition for caching, so with the cache on the StatsBar would have timed a
 * `Record` lookup and presented it as a download from the second query onward
 * — and those numbers are the page's only evidence for its claim.
 *
 * The library no longer keeps a cache, so there is no longer a flag to set.
 * What repeats now cost is whatever the host's response headers say, which is
 * the browser's business and visible in devtools — a warm HTTP hit is still
 * served as a stream, so early resolution keeps working. With four sources
 * running from 8 MB to 240 MB, that early resolution is now the whole point:
 * a match near the head of the largest file should resolve in a fraction of
 * the time a full miss takes to drain it, and `elapsedMs` below is what makes
 * that difference visible per source rather than only in the aggregate.
 *
 * Note that overlapping runs still double-fetch, and always did: a keystroke
 * ABORTS the previous search, and an aborted download was never something a
 * later one could share. That is accepted — an aborted `fetch` stops the
 * transfer rather than merely abandoning it, so a fast typist does not queue
 * up hundreds of megabytes of superseded reads.
 */
const netgrep = new Netgrep();

/**
 * Counting has to be in place before the first search, and this module is the
 * only thing that starts one. Idempotent, so a second import costs nothing.
 */
installScanMeter();

/**
 * Built once. The metadata generic carries each source's id back into the
 * callback, so a result can be matched to its panel without parsing the url.
 */
const inputs = sources.map((source) => ({
  url: logUrl(source),
  metadata: { id: source.id },
}));

const sourceIds = sources.map((source) => source.id);

function idleState(): SearchState {
  return {
    statuses: {},
    lines: {},
    pending: {},
    elapsedMs: {},
    scanned: {},
    matched: 0,
    scannedTotal: 0,
    answered: 0,
    firstMatchMs: null,
    allAnsweredMs: null,
    error: null,
    running: false,
  };
}

/**
 * Search all four log sources for `pattern`, reporting each as it resolves.
 *
 * Uses `searchBatchWithCallback` rather than `searchBatch`. The batch method is
 * `Promise.all`, so nothing could render until the slowest of the four
 * downloads finished — which for the 240 MB OpenSSH source on a miss would
 * hide the one behaviour this demo exists to show.
 */
export function useLogSearch(pattern: string): SearchState {
  const [state, setState] = useState<SearchState>(idleState);

  /**
   * Identifies the current run. An aborted `fetch` still rejects, and
   * `searchBatchWithCallback` turns that rejection into a callback carrying an
   * error — so without this, cancelling a search would repaint the dashboard
   * with four spurious failures from a query the user has already replaced.
   */
  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;

    if (!pattern) {
      setState(idleState());
      return;
    }

    const controller = new AbortController();
    const startedAt = performance.now();

    // The two things a run is measured against, zeroed together. The previous
    // run's downloads were aborted by this effect's cleanup a moment ago, so
    // nothing is being counted when the counters go back to zero.
    beginScanRun();

    // Stale-while-revalidate: the previous run's data stays in state, and each
    // panel replaces its own only when its own new answer arrives. Clearing it
    // all here instead makes the dashboard flash — on every debounced keystroke
    // four panels blank and refill milliseconds later.
    //
    // What is NOT carried over is the claim that any of it is current: `pending`
    // goes true for every source, and it is the panel's job to stop presenting
    // a verdict, a time and a highlight it can no longer stand behind.
    setState((prev) => ({
      ...prev,
      statuses: Object.fromEntries(
        sourceIds.map((id) => [
          id,
          prev.statuses[id] ?? ('searching' as const),
        ]),
      ),
      pending: Object.fromEntries(sourceIds.map((id) => [id, true])),
      matched: 0,
      scannedTotal: 0,
      answered: 0,
      firstMatchMs: null,
      allAnsweredMs: null,
      error: null,
      running: true,
    }));

    netgrep.searchBatchWithCallback(
      inputs,
      pattern,
      (result) => {
        // Belongs to a superseded query: drop it silently.
        if (run !== runRef.current) return;

        const id = result.metadata?.id;
        if (!id) return;

        const elapsed = performance.now() - startedAt;

        // Read here rather than inside the updater: the counter is a live
        // mutable total, and an updater React may re-run would sample it again
        // later, after more of a still-draining sibling had arrived.
        const bytes = scannedBytes(result.url);

        setState((prev) => {
          const status: SourceStatus = result.error
            ? 'failed'
            : result.result
              ? 'matched'
              : 'missed';

          // Read off the discriminant rather than off `status`: narrowing
          // `result.result` is what gives `result.line` its `string` type, and
          // the derived `status` above carries none of that.
          const line: MatchedLine | null = result.result
            ? { text: result.line, ranges: result.ranges }
            : null;

          const statuses = { ...prev.statuses, [id]: status };
          const matched = prev.matched + (status === 'matched' ? 1 : 0);
          const answered = prev.answered + 1;
          const done = answered === inputs.length;

          return {
            statuses,
            // A miss leaves the previous line in place, exactly as it leaves
            // the previous status: the panel is repainted by its own answer.
            lines: line === null ? prev.lines : { ...prev.lines, [id]: line },
            pending: { ...prev.pending, [id]: false },
            elapsedMs: { ...prev.elapsedMs, [id]: elapsed },
            scanned: { ...prev.scanned, [id]: bytes },
            matched,
            scannedTotal: prev.scannedTotal + bytes,
            answered,
            firstMatchMs:
              prev.firstMatchMs === null && status === 'matched'
                ? elapsed
                : prev.firstMatchMs,
            allAnsweredMs: done ? elapsed : null,
            error: prev.error ?? result.error,
            running: !done,
          };
        });
      },
      {
        signal: controller.signal,
        capture: 'line-ranges',
        maxLineBytes: MAX_LINE_BYTES,
      },
    );

    return () => controller.abort();
  }, [pattern]);

  return state;
}
