import { Check, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import type { LogSource } from '@/data/logs';
import type { MatchedLine, SourceStatus } from '@/hooks/use-log-search';
import { formatBytes, formatMs } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The column widths, declared once because two elements have to agree on them:
 * the header rule and every row under it. Four rows whose service names and
 * elapsed times do not line up read as four cards; lined up, they read as a
 * table, which is the whole difference between this and the grid it replaced.
 *
 * The service column is `sm:`-prefixed because it is the only one that changes
 * below that breakpoint, where it gives up its fixed width and takes the space
 * the file name vacates. The header carries no unprefixed variant of it and
 * needs none: the header itself is hidden below `sm`.
 */
const SERVICE_COL = 'sm:w-28 sm:shrink-0';
const STATUS_COL = 'w-[5.5rem] shrink-0 text-right';
const ELAPSED_COL = 'w-16 shrink-0 text-right';

/** The word each state is announced with, in the log-tailing vocabulary. */
const STATUS_LABEL: Record<SourceStatus, string> = {
  idle: 'idle',
  searching: 'streaming',
  matched: 'matched',
  missed: 'no match',
  failed: 'failed',
};

/**
 * The matched line with each match wrapped in <mark>.
 *
 * Ranges are UTF-16 offsets into `text` — exactly what `slice` takes — and
 * arrive sorted and non-overlapping, so one forward walk covers the string.
 * `ranges` can be empty (every match past the byte cap): then the line
 * renders unmarked, which is honest — the visible text contains no match.
 */
function highlight({ text, ranges }: MatchedLine): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach(({ start, end }) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    if (end > start) {
      // `start` alone is a stable key: ranges are sorted and non-overlapping,
      // so starts are strictly increasing and unique.
      parts.push(
        <mark
          key={start}
          className="bg-primary/20 text-foreground rounded-[2px] px-0.5"
        >
          {text.slice(start, end)}
        </mark>,
      );
    }
    cursor = Math.max(cursor, end);
  });

  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts;
}

/**
 * The column rule above the panels.
 *
 * Carries a transparent border so its box model matches a panel's — a `Card`
 * has a 1px border, and without this the labels sit one pixel off the values
 * they name, which is visible precisely because everything else aligns.
 */
export function LogPanelHeader() {
  return (
    <div className="text-muted-foreground/50 hidden items-center gap-x-3 border border-transparent px-3.5 pb-1.5 text-[10px] tracking-wider uppercase sm:flex">
      <span className="size-4 shrink-0" aria-hidden="true" />
      <span className={SERVICE_COL}>Source</span>
      <span className="min-w-0 flex-1">File</span>
      <span className={STATUS_COL}>Status</span>
      <span className={ELAPSED_COL}>Elapsed</span>
    </div>
  );
}

type LogPanelProps = {
  source: LogSource;
  /** The file's real size in bytes, from the generated manifest. */
  bytes: number;
  status: SourceStatus;
  /** The first matching line, when this source matched. */
  line?: MatchedLine;
  /** Milliseconds from the run's start to this source's own answer. */
  elapsedMs?: number;
  /**
   * Whether `status`, `line` and `elapsedMs` still describe the previous query.
   * True from the start of a run until this source answers it.
   */
  pending?: boolean;
};

/**
 * One log source, as a dashboard row.
 *
 * The elapsed time is the figure worth reading, so it is the only large number
 * here and it is the last thing on the line. Note that misses are NOT faded the
 * way the old story cards were: a miss is when the elapsed time is at its most
 * interesting — it is what draining the whole file to the end costs — and
 * dimming the row would hide the number that makes the page's argument.
 *
 * There is no progress bar, because there is no progress to report: the library
 * exposes no byte counter, so a bar here would be an animation pretending to be
 * a measurement. The pulsing hairline says "this source is being read right
 * now" and claims nothing further.
 *
 * WHILE `pending`, THIS ROW MAY NOT ASSERT ANYTHING. The state it holds belongs
 * to the previous query, so the verdict, the elapsed time and the highlight all
 * stand down: the row reads `streaming`, the time reads `—`, and the last
 * matching line stays visible but dimmed and unmarked, as context for what is
 * being replaced rather than as an answer. Blanking it instead was tried in the
 * design this replaced and is worse — four rows emptying and refilling on every
 * keystroke — but a lit teal row reading `MATCHED · 15ms` and quoting a
 * highlighted phrase that is not in the search box is not a cosmetic problem.
 * It is the page telling the visitor something untrue for two seconds, on a
 * page whose only claim on their attention is that its numbers are real.
 */
export function LogPanel({
  source,
  bytes,
  status,
  line,
  elapsedMs,
  pending = false,
}: LogPanelProps) {
  // Nothing but `streaming` can be shown for a source that has not answered the
  // query currently in the box.
  const shown: SourceStatus = pending ? 'searching' : status;

  // The stored verdict, not the shown one: a re-searching row keeps its quote.
  const quoting = status === 'matched' && line !== undefined;

  const isMatched = shown === 'matched';
  const isMissed = shown === 'missed';
  const isSearching = shown === 'searching';
  const isFailed = shown === 'failed';

  return (
    <Card
      className={cn(
        // Enumerated rather than `transition-all`, which is a list of every
        // property the browser could animate rather than of what this row
        // changes: a match tints the surface and lifts it, a failure reddens
        // it, and that is the whole set. `opacity` is the one deliberately kept
        // out — `animate-pulse` drives it from keyframes on the hairline, the
        // dot and the status word, and those three enumerate for the same
        // reason.
        'relative overflow-hidden duration-300',
        'transition-[border-color,background-color,box-shadow]',
        isMatched &&
          'border-primary/40 bg-primary/[0.06] shadow-[0_0_0_1px_var(--color-primary)/10,0_8px_30px_-12px_var(--color-primary)]',
        isFailed && 'border-destructive/40 bg-destructive/[0.06]',
      )}
    >
      {isSearching && (
        <span className="bg-primary/70 absolute inset-x-0 top-0 h-px animate-pulse" />
      )}

      <div className="flex flex-wrap items-center gap-x-3 px-3.5 py-2.5">
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
            isMatched && 'border-primary bg-primary text-primary-foreground',
            isMissed && 'border-muted-foreground/30',
            isSearching && 'border-primary/40 animate-pulse',
            isFailed && 'border-destructive text-destructive',
          )}
          aria-hidden="true"
        >
          {isMatched && <Check className="size-3" strokeWidth={3} />}
          {isFailed && <TriangleAlert className="size-2.5" />}
        </span>

        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm leading-snug font-medium transition-colors sm:flex-none',
            SERVICE_COL,
            isMatched ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {source.service}
        </span>

        {/*
          Below `sm` the four columns do not fit on one line, and the first
          thing to go is the file name — truncated to `apache.txt · 8.3…`,
          which drops the size. So it wraps to its own line instead: `w-full`
          on a wrapping row takes the whole second line, and `order-last` is
          what puts it after the two figures rather than in front of them.
          `pl-7` lines it up under the service name, past the status dot.
        */}
        <span className="text-muted-foreground/70 order-last mt-0.5 w-full truncate pl-7 font-mono text-[11px] tabular-nums sm:order-none sm:mt-0 sm:w-auto sm:min-w-0 sm:flex-1 sm:pl-0">
          {source.file}
          <span className="text-muted-foreground/40"> · </span>
          {formatBytes(bytes)}
        </span>

        <span
          className={cn(
            'text-[10px] leading-none tracking-wider uppercase transition-colors',
            STATUS_COL,
            isMatched && 'text-primary',
            isFailed && 'text-destructive',
            isSearching && 'text-primary/70 animate-pulse',
            (isMissed || shown === 'idle') && 'text-muted-foreground/60',
          )}
        >
          {STATUS_LABEL[shown]}
        </span>

        <span
          className={cn(
            'font-mono text-sm leading-none tabular-nums transition-colors',
            ELAPSED_COL,
            isMatched ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {pending || elapsedMs === undefined ? '—' : formatMs(elapsedMs)}
        </span>
      </div>

      {/*
        The matching line.

        Gated on the stored status rather than on `shown`, so a row that is
        re-searching keeps quoting while it streams — but see `stale` below: it
        quotes without the highlight, because the marks would point at a pattern
        the visitor is no longer searching for. A row whose stored status is a
        miss stops quoting altogether.

        The row's height is animated rather than jumped. When one source's line
        appears, every panel under it moves — up to three shifts inside half a
        second on a query that matches everything — and a dashboard that jolts
        while you are reading a number off it is hard to read. `grid-rows-[0fr]`
        to `[1fr]` is the one way to transition to a content height CSS cannot
        otherwise interpolate; the `overflow-hidden` child is what makes it
        clip rather than overflow while collapsed. The reduced-motion block in
        index.css flattens the duration, so this arrives instantly there.

        Collapsed is not the same as gone: the text is still in the DOM, so it
        is `aria-hidden` while clipped. Without that a screen reader would read
        out a log line that the sighted page has just retracted, which is the
        stale-claim problem again in the one place it would be hardest to spot.

        Clamped to two rows: the library caps the line at a byte count, and a
        byte count is not a row count. Without the clamp one long line — the
        Zookeeper seed has some — would make its panel several times the height
        of the other three.
      */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          quoting ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        aria-hidden={!quoting}
      >
        <div className="overflow-hidden">
          <div className="border-border/60 border-t px-3.5 py-2">
            <p
              className={cn(
                'line-clamp-2 font-mono text-[11px] leading-relaxed break-words transition-colors',
                pending ? 'text-muted-foreground/50' : 'text-foreground/80',
              )}
            >
              {/* Stale: the text is context, the marks would be a claim. */}
              {line !== undefined && (pending ? line.text : highlight(line))}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
