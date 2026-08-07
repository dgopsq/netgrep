import type { NetgrepHit } from '@netgrep/netgrep';
import { highlight } from '@/lib/highlight';
import { windowLine } from '@/lib/window-line';

/**
 * One matching line.
 *
 * FIXED HEIGHT, ONE LINE, CLIPPED — `leading-6` is 24px and matches
 * `ROW_HEIGHT` in `result-feed.tsx`. Those two numbers are one number and must
 * move together; a wrapped row makes every offset the virtualizer computed
 * wrong, and the symptom is rows overlapping rather than anything that reads
 * like a height bug.
 *
 * It is also what grep output looks like, which is the point.
 *
 * CLIPPED IS WHY THE LINE IS WINDOWED FIRST. Rendering from offset 0 and
 * letting CSS cut the overflow meant a match at column 300 never appeared, so
 * the row read as a false positive — a result with nothing in it to explain why
 * it is a result. `windowLine` keeps the head, elides the middle and brings the
 * first match into view, which preserves the fixed height that the rest of this
 * arrangement depends on. Wrapping was the alternative and was rejected: it
 * retires `ROW_HEIGHT`, forces per-row measurement, and makes 100,000 ragged
 * rows harder to skim than the uniform grid they replace.
 *
 * ⚠️ THE LINE NUMBER IS EXACT HERE ONLY BECAUSE OF THESE SEEDS. `grep`'s
 * running line base gains a line at every 64 KB window slide inside a line
 * with no terminator (BACKLOG 3g), so the number is approximate past such a
 * line. `docs/ARCHITECTURE.md` records that this is unreachable in the demo's
 * logs — the longest line across all four is 387 bytes. A future seed carrying
 * a 100 KB line silently turns every number in this gutter into a guess, and
 * nothing on the page or in CI would catch it.
 */
export function ResultRow({ hit }: { hit: NetgrepHit }) {
  // The line is windowed onto its first match before it is highlighted, so a
  // match past the visible width still shows. `windowLine` rebases the ranges
  // onto the text it returns, and the two are used together or not at all.
  const line = windowLine(hit.line, hit.ranges);

  return (
    <div className="hover:bg-card/60 flex gap-3 px-3 font-mono text-[12px] leading-6 transition-colors">
      <span className="text-muted-foreground/40 w-16 shrink-0 text-right tabular-nums select-none">
        {hit.lineNumber}
      </span>
      <span
        className="text-foreground/85 min-w-0 flex-1 truncate"
        // Only on a windowed row, and it carries the WHOLE line: the gap is the
        // one thing on this page that hides content the search actually read,
        // so there has to be some way back to it.
        title={line.elided ? hit.line : undefined}
      >
        {highlight(line.text, line.ranges)}
      </span>
    </div>
  );
}
