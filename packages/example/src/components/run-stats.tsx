import type { GrepStreamState } from '@/hooks/use-grep-stream';
import {
  formatBytes,
  formatMs,
  formatShare,
  formatThroughput,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * One figure and its label, on a single baseline.
 *
 * A `dt`/`dd` pair rather than two spans, so a screen reader reads "first
 * match, 27ms" instead of two unrelated strings.
 *
 * Label beside the value, not above it: this row is sticky for the whole run,
 * and stacking made the card ~155px of feed nobody sees.
 */
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-muted-foreground/60 shrink-0 text-[10px] tracking-wider uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'truncate font-mono text-sm tabular-nums',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The numbers that make the point.
 *
 * "First match" against "Elapsed" is the argument in two figures: the first
 * line lands while the file is almost entirely undownloaded, and the run
 * continues to the last byte because that is what enumeration costs.
 *
 * "First byte" sits before both and is not the library's: it is the pause
 * before the feed moves, seconds on the large files when the host has to fetch
 * one before it can serve it. Unreported, that wait is charged to "First match"
 * and read as the engine being slow to start.
 *
 * ⚠️ THROUGHPUT IS END-TO-END, NOT AN ENGINE BENCHMARK, and `RunStatsNote` is
 * where the page says so — which is why that note may not be dropped. It is a
 * separate component only because this row is sticky and static prose need not
 * be; keep both in this file, which `docs/BACKLOG.md` points at for the
 * WebAssembly figure the note carries.
 *
 * Memory held is not reported and cannot be: no browser API gives an honest
 * per-stream figure, so any number there would be fabricated.
 *
 * THE READ METER IS THIS CARD ITSELF — a gradient sweep behind the figures and a
 * rule along the bottom border, both sized by bytes actually delivered over the
 * manifest's real size. Do not drive it from elapsed time or a guess; a
 * progress bar was refused here until both numbers were measured.
 */
export function RunStats({
  state,
  totalBytes,
}: {
  state: GrepStreamState;
  /** The selected file's real size, from the generated manifest. */
  totalBytes: number;
}) {
  const share = totalBytes > 0 ? Math.min(state.bytesRead / totalBytes, 1) : 0;

  // An uncompilable pattern fails in milliseconds having read nothing, so every
  // figure is true and misleading at once: `0` and `3ms` read as a completed
  // search rather than a refusal. The alert above already says what happened.
  const uncompiled = state.error !== null && !state.partial;

  const dash = (value: string) => (uncompiled ? '—' : value);

  return (
    // Square along the bottom: the meter is pinned to that edge, and a radius
    // clips its ends into stubs, so a full read never looks full.
    <div className="border-border/60 bg-card/40 relative overflow-hidden rounded-t-lg border backdrop-blur">
      {/*
        Decorative; the `progressbar` below carries the same number for screen
        readers. It is a sibling rather than this card's role because
        `progressbar` makes its children presentational, which would hide all
        five figures to announce a percentage.

        Only advancing is smoothed — a new run publishes `bytesRead` as 0, and
        easing back would animate a read that is not happening.
      */}
      <div
        aria-hidden="true"
        className={cn(
          'read-meter-sweep absolute inset-y-0 left-0',
          share > 0 && 'transition-[width] duration-150 ease-linear',
        )}
        style={{ width: `${share * 100}%` }}
      />

      {/*
        THE TRACK, always drawn: a bar needs a visible remainder to be a
        fraction of. Without it a finished run is just a teal underline.
      */}
      <div
        aria-hidden="true"
        className="bg-border/70 absolute inset-x-0 bottom-0 h-[3px]"
      />

      {/* The filled part. The sweep above is atmosphere; this is the reading. */}
      <div
        aria-hidden="true"
        className={cn(
          'read-meter-edge absolute bottom-0 left-0 h-[3px]',
          share > 0 && 'transition-[width] duration-150 ease-linear',
        )}
        style={{ width: `${share * 100}%` }}
      />

      <div
        className="sr-only"
        role="progressbar"
        aria-label="File content read"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={`${formatBytes(state.bytesRead)} of ${formatBytes(
          totalBytes,
        )}, ${formatShare(state.bytesRead, totalBytes)}`}
      />

      {/* `relative` lifts the figures over the fill behind them. */}
      <dl className="relative flex flex-wrap items-baseline gap-x-5 gap-y-1.5 px-4 py-2.5">
        <Stat
          label="Matching lines"
          value={dash(state.total.toLocaleString())}
          accent={!uncompiled && state.total > 0}
        />
        <Stat
          label="First byte"
          value={dash(
            state.firstByteMs === null ? '—' : formatMs(state.firstByteMs),
          )}
        />
        <Stat
          label="First match"
          value={dash(
            state.firstMatchMs === null ? '—' : formatMs(state.firstMatchMs),
          )}
          accent
        />
        <Stat label="Scanned" value={dash(formatBytes(state.bytesRead))} />
        <Stat label="Elapsed" value={dash(formatMs(state.elapsedMs))} />
        <Stat
          label="Throughput"
          value={dash(formatThroughput(state.bytesRead, state.elapsedMs))}
        />
      </dl>
    </div>
  );
}

/**
 * What the figures above mean, and what they are not.
 *
 * ⚠️ A TERM OF THE MEASUREMENT, NOT A CAPTION. It may not be shortened past the
 * point where it separates decompressed content from bytes on the wire: the
 * logs are gzipped at ~16×, so a `Scanned` of 240.2 MB moved roughly 15 MB, and
 * dropping this overstates bandwidth sixteenfold. Same for the throughput and
 * first-byte clauses, which keep a CDN measurement from wearing the library's
 * name.
 *
 * The 1.17 MB WebAssembly figure is a hand-written literal and has to move when
 * the binary does; `docs/BACKLOG.md` points at this file for it.
 */
export function RunStatsNote() {
  return (
    <p className="text-muted-foreground/70 text-xs leading-relaxed">
      Streamed from a static file, plus a 1.17 MB WebAssembly download once per
      page load. <strong className="font-medium">Scanned</strong> is
      uncompressed log content reaching the search, not bytes on the wire —
      these files are served gzipped at about 16×.{' '}
      <strong className="font-medium">First byte</strong> is the host's wait
      before any content arrives — seconds on the larger files when the CDN has
      to fetch them before it can serve them, and nothing netgrep controls.{' '}
      <strong className="font-medium">Throughput</strong> is end to end, so it
      measures the network as much as the engine. Every query reads the file to
      its last byte: the last matching line cannot be known before it.
    </p>
  );
}
