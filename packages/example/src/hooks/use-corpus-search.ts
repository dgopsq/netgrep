import type { NetgrepMatchRange } from '@netgrep/netgrep';
import { Netgrep } from '@netgrep/netgrep';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Story, stories } from '@/data/stories';
import { storyUrl } from '@/lib/story-url';

/**
 * How a single story is currently rendered.
 */
export type StoryStatus = 'idle' | 'searching' | 'match' | 'miss' | 'error';

/**
 * How much of a matching line the demo asks for.
 *
 * Well under the library's 4 KB default, because this page renders the line in
 * two clamped rows and anything past that is copied out of WebAssembly only to
 * be hidden by CSS. The corpus is prose — its longest line is 76 bytes — so in
 * practice nothing here is ever truncated; the cap is here because a demo that
 * ignores its own documented knobs teaches the wrong thing.
 */
const MAX_LINE_BYTES = 240;

export type MatchedLine = {
  text: string;
  ranges: NetgrepMatchRange[];
};

export type SearchState = {
  /** Status per story id. */
  statuses: Record<string, StoryStatus>;
  /**
   * The first matching line and where the pattern matches within it, per
   * story id, for stories that matched.
   *
   * Kept across runs for the same reason `statuses` is — see the
   * stale-while-revalidate note below. A card's line is replaced when that
   * card's own new answer arrives, not when the query changes.
   */
  lines: Record<string, MatchedLine>;
  /** The order the grid renders in — see `settle()` below. */
  order: string[];
  matched: number;
  resolved: number;
  /** Milliseconds from the first byte requested to the first match resolving. */
  firstMatchMs: number | null;
  /** Milliseconds until every file had an answer. */
  completedMs: number | null;
  /**
   * The engine's own diagnostic when the pattern will not compile. Since
   * `search_bytes` returns a `Result`, an unbalanced `(` arrives here as
   * regex-crate prose rather than as `RuntimeError: unreachable`.
   */
  error: string | null;
  running: boolean;
};

/**
 * THE PAGE MEASURES THE NETWORK, AND SINCE 0024 IT DOES SO BY CONSTRUCTION.
 *
 * netgrep used to keep downloaded bytes in memory, on by default, and this
 * page switched it off: a miss drains the stream, which is exactly the
 * condition for caching, so with the cache on the StatsBar would have timed a
 * `Record` lookup and presented it as a download from the second query onward
 * — and those numbers are the page's only evidence for its claim.
 *
 * Decision 0024 removed the cache from the library, so there is no longer a
 * flag to set. What repeats now cost is whatever the host's response headers
 * say, which is the browser's business and visible in devtools — a warm HTTP
 * hit is still served as a stream, so early resolution keeps working.
 *
 * Note that overlapping runs still double-fetch, and always did: a keystroke
 * ABORTS the previous search, and an aborted download was never something a
 * later one could share. That is accepted.
 */
const netgrep = new Netgrep();

/**
 * Built once. The metadata generic carries each story's id back into the
 * callback, so a result can be matched to its card without parsing the url.
 */
const inputs = stories.map((story) => ({
  url: storyUrl(story.file),
  metadata: { id: story.id },
}));

const alphabetical = stories.map((story) => story.id);

function idleState(order: string[]): SearchState {
  return {
    statuses: {},
    lines: {},
    order,
    matched: 0,
    resolved: 0,
    firstMatchMs: null,
    completedMs: null,
    error: null,
    running: false,
  };
}

/**
 * Matches first, then everything else, each alphabetical.
 *
 * Applied ONLY once a run has finished, never while it is streaming. Sorting
 * live would be the honest reading of "matches rise to the top", but results
 * arrive in whatever order 56 concurrent downloads happen to resolve, so cards
 * would jump under the cursor for the whole search. Re-ordering once, at the
 * end, is what "settle" means.
 */
function settle(statuses: Record<string, StoryStatus>): string[] {
  return [...alphabetical].sort((a, b) => {
    const aMatched = statuses[a] === 'match' ? 0 : 1;
    const bMatched = statuses[b] === 'match' ? 0 : 1;

    return aMatched - bMatched;
  });
}

/**
 * Search the whole corpus for `pattern`, reporting each file as it resolves.
 *
 * Uses `searchBatchWithCallback` rather than `searchBatch`. The batch method is
 * `Promise.all`, so nothing could render until the slowest of 56 downloads
 * finished — which would hide the one behaviour this demo exists to show.
 */
export function useCorpusSearch(pattern: string): SearchState {
  const [state, setState] = useState<SearchState>(() =>
    idleState(alphabetical),
  );

  /**
   * Identifies the current run. An aborted `fetch` still rejects, and
   * `searchBatchWithCallback` turns that rejection into a callback carrying an
   * error — so without this, cancelling a search would repaint the grid with 56
   * spurious failures from a query the user has already replaced.
   */
  const runRef = useRef(0);

  useEffect(() => {
    const run = ++runRef.current;

    if (!pattern) {
      setState(idleState(alphabetical));
      return;
    }

    const controller = new AbortController();
    const startedAt = performance.now();

    // Stale-while-revalidate: the previous run's verdicts stay on screen, and
    // each card changes only when its own new answer arrives.
    //
    // Resetting every card to `searching` here instead — which this did — makes
    // the grid flash: on each debounced keystroke all 56 cards drop their
    // verdict, then re-acquire it milliseconds later. Only cards that have
    // never been searched show the searching state; the running indicator in
    // the field and the counter in the stats bar carry the in-flight signal for
    // everything else.
    setState((prev) => ({
      ...prev,
      statuses: Object.fromEntries(
        alphabetical.map((id) => [
          id,
          prev.statuses[id] ?? ('searching' as const),
        ]),
      ),
      // The order is deliberately NOT reset to alphabetical. Doing so reordered
      // the grid twice per search — once back to alphabetical at the start and
      // once to settled at the end — so cards visibly jumped in both
      // directions. It now moves once, at the end, and `use-flip.ts` animates
      // that move.
      matched: 0,
      resolved: 0,
      firstMatchMs: null,
      completedMs: null,
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
          const status: StoryStatus = result.error
            ? 'error'
            : result.result
              ? 'match'
              : 'miss';

          // Read off the discriminant rather than off `status`: narrowing
          // `result.result` is what gives `result.line` its `string` type, and
          // the derived `status` above carries none of that.
          const line: MatchedLine | null = result.result
            ? { text: result.line, ranges: result.ranges }
            : null;

          const statuses = { ...prev.statuses, [id]: status };
          const matched = prev.matched + (status === 'match' ? 1 : 0);
          const resolved = prev.resolved + 1;
          const done = resolved === inputs.length;

          return {
            statuses,
            // A miss leaves the previous line in place, exactly as it leaves
            // the previous status: the card is repainted by its own answer.
            lines: line === null ? prev.lines : { ...prev.lines, [id]: line },
            order: done ? settle(statuses) : prev.order,
            matched,
            resolved,
            firstMatchMs:
              prev.firstMatchMs === null && status === 'match'
                ? elapsed
                : prev.firstMatchMs,
            completedMs: done ? elapsed : null,
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

/**
 * The corpus, in the order the grid should render it.
 */
export function useOrderedStories(order: string[]): Story[] {
  return useMemo(() => {
    const byId = new Map(stories.map((story) => [story.id, story]));

    return order
      .map((id) => byId.get(id))
      .filter((story): story is Story => story !== undefined);
  }, [order]);
}
