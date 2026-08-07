import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
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
 * The scroll container has a FIXED HEIGHT rather than growing with its content.
 * A list that grows pushes the footer down 2.4 million rows and hands the
 * virtualizer the window as its scroll element, which is the one arrangement
 * where it cannot bound what it renders.
 */
export function ResultFeed({
  state,
  service,
}: {
  state: GrepStreamState;
  service: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: state.retained,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const rows = virtualizer.getVirtualItems();

  return (
    <div className="border-border/60 bg-card/40 overflow-hidden rounded-xl border backdrop-blur">
      <div className="border-border/60 text-muted-foreground/70 flex items-baseline justify-between border-b px-4 py-2.5 text-xs">
        <span className="font-medium">{service}</span>
        <span className="font-mono tabular-nums">{countLabel(state)}</span>
      </div>

      <div
        ref={scrollRef}
        className="h-[28rem] overflow-auto overscroll-contain"
      >
        {state.retained === 0 ? (
          <p className="text-muted-foreground/50 px-4 py-10 text-center text-sm">
            {state.running
              ? 'Reading the file…'
              : 'No line in this file matches that pattern.'}
          </p>
        ) : (
          // The spacer carries the full scroll height and each row is placed
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
                  transform: `translateY(${row.start}px)`,
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
