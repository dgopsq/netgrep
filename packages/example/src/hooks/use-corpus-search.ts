import { Netgrep } from '@netgrep/netgrep';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Story, stories } from '@/data/stories';
import { storyUrl } from '@/lib/story-url';

/**
 * How a single story is currently rendered.
 */
export type StoryStatus = 'idle' | 'searching' | 'match' | 'miss' | 'error';

export type SearchState = {
  /** Status per story id. */
  statuses: Record<string, StoryStatus>;
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
 * THE MEMORY CACHE IS OFF, DELIBERATELY.
 *
 * Two of the library's documented P1 defects only exist when it is on, and both
 * produce visibly wrong answers on a page where people type one query after
 * another:
 *
 *   - Poisoned partial cache (backlog 3b). `search` resolves on the first match,
 *     so the cache keeps only the PREFIX it happened to read. A later query for
 *     a term further down the same file is then answered `false` from text that
 *     was never downloaded.
 *   - Concurrent searches double a cache entry (backlog 18). Nothing tracks a
 *     download already in flight, so two searches of one url started together
 *     both append what they read — joining the file to itself with no
 *     separator, forming a line that exists nowhere.
 *
 * Turning it off costs little here: the corpus is 2.6 MB and the browser's own
 * HTTP cache serves repeat queries. It does not affect the property this page
 * exists to show — a match still resolves the moment it is seen, mid-download.
 *
 * See docs/BACKLOG.md and AGENTS.md §7.
 */
const netgrep = new Netgrep({ enableMemoryCache: false });

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

          const statuses = { ...prev.statuses, [id]: status };
          const matched = prev.matched + (status === 'match' ? 1 : 0);
          const resolved = prev.resolved + 1;
          const done = resolved === inputs.length;

          return {
            statuses,
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
      { signal: controller.signal },
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
