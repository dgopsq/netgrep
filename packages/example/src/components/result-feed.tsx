import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import { ResultRow } from '@/components/result-row';
import type { GrepStreamState } from '@/hooks/use-grep-stream';
import { MAX_RETAINED_HITS } from '@/lib/hit-buffer';

/**
 * One row's height in pixels. Must equal `leading-6` on `ResultRow` — see the
 * comment there.
 */
export const ROW_HEIGHT = 24;

/** Rows rendered beyond the viewport, so a fast scroll does not show gaps. */
const OVERSCAN = 24;

function countLabel(state: GrepStreamState): string {
  if (state.total === 0)
    return state.running ? 'reading…' : 'no matching lines';

  const total = state.total.toLocaleString();

  // The ceiling is stated as a fact about the PAGE, not about the search. The
  // total beside it is the real one: counting continued after storing stopped.
  return state.truncated
    ? `showing ${state.retained.toLocaleString()} of ${total} matching lines`
    : `${total} matching lines`;
}

/**
 * Every matching line, as it arrives.
 *
 * DELIBERATELY DOES NOT FOLLOW THE TAIL. Auto-scrolling to the newest row was
 * considered and rejected: at the rate hits arrive it is an unreadable blur,
 * and it takes the scroll away from anyone trying to read one. The streaming is
 * legible without it — the count moves, the meter runs, and the scrollbar thumb
 * visibly shrinks as rows pour in, which says the same thing and can be read.
 *
 * THE PAGE IS THE SCROLL CONTAINER — there is exactly one scrollbar, the
 * window's, and this list grows to its full height inside it.
 *
 * An earlier revision gave the feed a fixed `h-[28rem]` and its own scrollbar,
 * on the argument that handing the virtualizer the window was "the one
 * arrangement where it cannot bound what it renders". THAT ARGUMENT WAS SIMPLY
 * WRONG: `useWindowVirtualizer` takes the window as the scroll element by
 * design and bounds the rendered window exactly as the element version does —
 * still ~60 rows in the DOM whatever the match count. A nested scroller was
 * buying nothing and cost a visitor the two-scrollbar tangle where a flick of
 * the wheel scrolls whichever region the pointer happens to be over.
 *
 * ⚠️ WHAT THE OLD COMMENT GOT RIGHT IS THE CONSEQUENCE, AND IT IS REAL. At the
 * retention ceiling this list is 100,000 × 24px — about 2.4 MILLION pixels of
 * document — so the footer below it is genuinely a long way down and the
 * scrollbar thumb becomes a sliver. That is accepted deliberately: the thumb
 * shrinking as hits pour in is legible evidence of the stream, and the licence
 * attribution in the footer is reachable by `End`. Anything added below this
 * feed inherits the same problem, so add it above.
 */
export function ResultFeed({
  state,
  service,
}: {
  state: GrepStreamState;
  service: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [listTop, setListTop] = useState(0);

  // Where this list starts in the DOCUMENT. The window virtualizer needs it to
  // turn a scroll position into a row index, and everything above the list
  // moves it: the hero, the sticky controls, and an error banner that appears
  // and disappears mid-run. So it is measured after every render rather than
  // once on mount — `getBoundingClientRect` plus `scrollY` rather than
  // `offsetTop`, which would be relative to the nearest positioned ancestor and
  // silently wrong the moment one is added above.
  //
  // Re-rendering on an unchanged value is the thing to avoid here, since this
  // component already re-renders once per animation frame during a run; the
  // equality check makes the steady state a no-op.
  useLayoutEffect(() => {
    const top = listRef.current
      ? listRef.current.getBoundingClientRect().top + window.scrollY
      : 0;

    setListTop((previous) => (previous === top ? previous : top));
  });

  const virtualizer = useWindowVirtualizer({
    count: state.retained,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin: listTop,
  });

  const rows = virtualizer.getVirtualItems();

  return (
    <div className="border-border/60 bg-card/40 overflow-hidden rounded-xl border backdrop-blur">
      <div className="border-border/60 text-muted-foreground/70 flex items-baseline justify-between border-b px-4 py-2.5 text-xs">
        <span className="font-medium">{service}</span>
        <span className="font-mono tabular-nums">{countLabel(state)}</span>
      </div>

      <div ref={listRef}>
        {state.retained === 0 ? (
          // ⚠️ THE MIN-HEIGHT IS LOAD-BEARING, NOT DECORATION. A run starts by
          // publishing an empty state, and an empty feed used to make the whole
          // document barely taller than the viewport — so the window's scroll
          // was clamped to a tiny maximum, and `App`'s move to the sticky
          // anchor could not land. Holding most of a viewport here keeps that
          // offset reachable through the gap between a run starting and its
          // first rows arriving. It applies only while the list is empty, so a
          // feed with three rows in it is still three rows tall.
          <p className="text-muted-foreground/50 flex min-h-[60vh] items-center justify-center px-4 text-center text-sm">
            {state.running
              ? 'Reading the file…'
              : 'No line in this file matches that pattern.'}
          </p>
        ) : (
          // The spacer carries the full list height and each row is placed
          // absolutely inside it. `translateY` rather than `top` keeps the
          // rows on the compositor during a fast scroll.
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {rows.map((row) => (
              <div
                key={row.key}
                className="absolute inset-x-0 top-0"
                style={{
                  height: `${row.size}px`,
                  // `row.start` is a position in the WINDOW's scroll space, so
                  // the list's own document offset comes back off it to get a
                  // position inside this spacer.
                  transform: `translateY(${row.start - listTop}px)`,
                }}
              >
                {/* biome-ignore lint/style/noNonNullAssertion: row.index < state.retained by construction */}
                <ResultRow hit={state.hits[row.index]!} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/*
        THE CEILING IS THE PAGE'S, AND SAYING SO IS NOT OPTIONAL. What the demo
        retains and what the library retains are different claims, and this is
        the one page where letting them blur would be self-defeating — a visitor
        who reads "showing 100,000 of 2,413,882" and concludes netgrep buffers
        has learned the opposite of the thing being demonstrated.
      */}
      {state.truncated && (
        <p className="border-border/60 text-muted-foreground/60 border-t px-4 py-2 text-[11px] leading-relaxed">
          This page keeps the first {MAX_RETAINED_HITS.toLocaleString()} lines
          so the tab survives; the search read every one of them. What is
          bounded here is what the demo stores, not what netgrep holds — that
          stayed at one network chunk the whole way.
        </p>
      )}
    </div>
  );
}
