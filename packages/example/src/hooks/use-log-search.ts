import type { NetgrepMatchRange } from '@netgrep/netgrep';
import { Netgrep } from '@netgrep/netgrep';
import { useEffect, useRef, useState } from 'react';
import { logUrl, sources } from '@/data/logs';

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
   * Milliseconds from the run's first byte requested to each source's own
   * answer, per source id. With four files running from 8 MB to 240 MB, this
   * is the number the dashboard exists to show: not just whether a source
   * matched, but how long reading it — or reading all of it, on a miss —
   * actually took.
   */
  elapsedMs: Record<string, number>;
  matched: number;
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
    elapsedMs: {},
    matched: 0,
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

    // Stale-while-revalidate: the previous run's verdicts stay on screen, and
    // each panel changes only when its own new answer arrives.
    //
    // Resetting every panel to `searching` here instead makes the dashboard
    // flash: on each debounced keystroke all four panels drop their verdict,
    // then re-acquire it milliseconds later. Only panels that have never been
    // searched show the searching state; the running indicator in the field
    // and the counter in the stats bar carry the in-flight signal for
    // everything else.
    setState((prev) => ({
      ...prev,
      statuses: Object.fromEntries(
        sourceIds.map((id) => [
          id,
          prev.statuses[id] ?? ('searching' as const),
        ]),
      ),
      matched: 0,
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
            elapsedMs: { ...prev.elapsedMs, [id]: elapsed },
            matched,
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
