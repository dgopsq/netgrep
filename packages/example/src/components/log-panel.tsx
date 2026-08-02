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
  status: SourceStatus;
  /** The first matching line, when this source matched. */
  line?: MatchedLine;
  /** Milliseconds from the run's start to this source's own answer. */
  elapsedMs?: number;
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
 */
export function LogPanel({ source, status, line, elapsedMs }: LogPanelProps) {
  const isMatched = status === 'matched';
  const isMissed = status === 'missed';
  const isSearching = status === 'searching';
  const isFailed = status === 'failed';

  return (
    <Card
      className={cn(
        // Explicitly NOT `transition-all`: it would include `transform`, and
        // the pulse states already own everything that moves here.
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
          thing to go is the file name — truncated to `apache.log · 8.0…`,
          which drops the size. So it wraps to its own line instead: `w-full`
          on a wrapping row takes the whole second line, and `order-last` is
          what puts it after the two figures rather than in front of them.
          `pl-7` lines it up under the service name, past the status dot.
        */}
        <span className="text-muted-foreground/70 order-last mt-0.5 w-full truncate pl-7 font-mono text-[11px] tabular-nums sm:order-none sm:mt-0 sm:w-auto sm:min-w-0 sm:flex-1 sm:pl-0">
          {source.file}
          <span className="text-muted-foreground/40"> · </span>
          {formatBytes(source.targetBytes)}
        </span>

        <span
          className={cn(
            'text-[10px] leading-none tracking-wider uppercase transition-colors',
            STATUS_COL,
            isMatched && 'text-primary',
            isFailed && 'text-destructive',
            isSearching && 'text-primary/70 animate-pulse',
            (isMissed || status === 'idle') && 'text-muted-foreground/60',
          )}
        >
          {STATUS_LABEL[status]}
        </span>

        <span
          className={cn(
            'font-mono text-sm leading-none tabular-nums transition-colors',
            ELAPSED_COL,
            isMatched ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {elapsedMs === undefined ? '—' : formatMs(elapsedMs)}
        </span>
      </div>

      {/*
        The matching line, rendered only on a match. `line` outlives a status
        change — the hook keeps it while a new query is in flight — so this is
        gated on `isMatched` rather than on the string existing, or a row that
        has just become a miss would still be quoting.

        Clamped to two rows: the library caps the line at a byte count, and a
        byte count is not a row count. Without the clamp one long line — the
        Zookeeper seed has some — would make its panel several times the height
        of the other three.
      */}
      {isMatched && line !== undefined && (
        <div className="border-border/60 border-t px-3.5 py-2">
          <p className="text-foreground/80 line-clamp-2 font-mono text-[11px] leading-relaxed break-words">
            {highlight(line)}
          </p>
        </div>
      )}
    </Card>
  );
}
