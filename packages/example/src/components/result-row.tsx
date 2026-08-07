import type { NetgrepHit } from '@netgrep/netgrep';
import { highlight } from '@/lib/highlight';
import { windowLine } from '@/lib/window-line';

/**
 * One matching line.
 *
 * FIXED HEIGHT, ONE LINE, CLIPPED — `leading-6` is 24px and must equal
 * `ROW_HEIGHT` in `result-feed.tsx`. A wrapped row makes every offset the
 * virtualizer computed wrong, and the symptom is overlapping rows rather than
 * anything resembling a height bug. It is also what grep output looks like.
 *
 * Clipping is why the line is windowed first: rendering from offset 0 meant a
 * match at column 300 never appeared, so the row read as a false positive.
 * Wrapping was the alternative and was rejected — it retires `ROW_HEIGHT`,
 * forces per-row measurement, and makes 100,000 ragged rows harder to skim.
 *
 * ⚠️ THE LINE NUMBER IS EXACT ONLY BECAUSE OF THESE SEEDS. `grep`'s line base
 * gains a line at each 64 KB window slide inside a line with no terminator
 * (BACKLOG 3g), which needs a line longer than 64 KB; the longest across all
 * four seeds is 387 bytes. A future seed with a 100 KB line turns every number
 * in this gutter into a guess, and nothing in CI would catch it.
 */
export function ResultRow({ hit }: { hit: NetgrepHit }) {
  // Windowed onto the first match, so one past the visible width still shows.
  // The returned ranges are rebased onto the returned text; use them together.
  const line = windowLine(hit.line, hit.ranges);

  return (
    <div className="hover:bg-card/60 flex gap-3 px-3 font-mono text-[12px] leading-6 transition-colors">
      <span className="text-muted-foreground/40 w-16 shrink-0 text-right tabular-nums select-none">
        {hit.lineNumber}
      </span>
      <span
        className="text-foreground/85 min-w-0 flex-1 truncate"
        // The gap is the one place the page hides content the search read, so
        // a windowed row carries the whole line here.
        title={line.elided ? hit.line : undefined}
      >
        {highlight(line.text, line.ranges)}
      </span>
    </div>
  );
}
