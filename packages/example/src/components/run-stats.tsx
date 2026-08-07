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
 * A `dt`/`dd` pair rather than two spans: these are five name/value pairs, and
 * the markup may as well say so — a screen reader then reads "first match,
 * 27ms" instead of two unrelated strings.
 *
 * LABEL BESIDE THE VALUE, NOT ABOVE IT, AND THAT IS THE HEIGHT DECISION. This
 * row is sticky for the whole run, so every pixel it takes is a pixel of feed a
 * visitor never sees. Stacked labels made each figure two lines tall and the
 * card ~155px; inline they are one line that wraps only on narrow screens.
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
 * "First match" against "elapsed" is the whole argument in two figures: the
 * first matching line lands while the file is still almost entirely
 * undownloaded, and the run then continues to the last byte because that is
 * what enumerating every match costs. On the 240 MB source the gap between them
 * is seconds wide.
 *
 * ⚠️ THROUGHPUT IS END-TO-END AND IS NOT A BENCHMARK OF THE ENGINE. It is bytes
 * delivered over wall-clock time, so on the published site it measures GitHub
 * Pages and gzip inflation at least as much as it measures ripgrep. The note
 * below says so and may not be dropped.
 *
 * Memory held is still not reported and still cannot be: no browser API gives
 * an honest per-stream figure, so a number there would be a fabrication rather
 * than a measurement. Do not add one to make the page look instrumented.
 *
 * ⚠️ THE NOTE THAT QUALIFIES THESE FIGURES IS `RunStatsNote`, BELOW, AND IT IS
 * PART OF THEM. It is a separate component only because this row is sticky and
 * that prose is not — three static lines held on screen for a whole run cost
 * more than they give. It renders directly beneath the sticky bar, so it is
 * adjacent to these figures on first paint, which is when it is read. Keep the
 * two in this one file: they are one statement, and `docs/BACKLOG.md` points
 * here for the WebAssembly figure the note carries.
 *
 * THE READ METER IS THIS CARD ITSELF, not a bar of its own — a faint gradient
 * sweep behind the figures and a glowing rule along the bottom border, both
 * sized by the same measured ratio. It replaced a separate `ScanMeterBar` that
 * cost ~40px of a permanently sticky header to say one thing; the container the
 * figures already sit in says the same thing for free. The page refused a
 * progress bar at all until
 * `GrepOptions.onProgress` and the generator's `manifest.json` supplied a
 * measured numerator and a measured denominator — what was refused was an
 * animation impersonating a measurement, and this fill is a ratio of two known
 * numbers. Do not drive it from elapsed time, a guess, or anything that is not
 * bytes actually delivered.
 *
 * ⚠️ IT IS DECOMPRESSED FILE CONTENT, NOT BYTES ON THE WIRE — the logs are
 * served gzipped at about 16×, so a full card was carried by a fraction of the
 * transfer. `RunStatsNote` is where the page says so, which is why that note may
 * not be dropped.
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

  // A pattern that will not compile fails in milliseconds having read nothing,
  // and every figure below is then true and misleading at once: `0` and `3ms`
  // read as a completed search rather than as a refusal. The alert above says
  // what happened; these have nothing to add.
  const uncompiled = state.error !== null && !state.partial;

  const dash = (value: string) => (uncompiled ? '—' : value);

  return (
    <div className="border-border/60 bg-card/40 relative overflow-hidden rounded-lg border backdrop-blur">
      {/*
        Decorative, and `aria-hidden` for it: the accessible reading of this
        same number is the `progressbar` below, which is a sibling rather than
        this card's role because `progressbar` makes its children presentational
        — putting the role here would hide all five figures from a screen reader
        to announce a percentage.

        Emptying is instant and only advancing is smoothed: a new run publishes
        `bytesRead` as 0, and easing the fill back would spend 150ms animating a
        read that is not happening.
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
        The meter's leading edge, along the card's bottom border. The sweep
        above is atmosphere; THIS is the line you actually read a percentage
        off, which is why it is opaque and the wash behind it is barely there.
      */}
      <div
        aria-hidden="true"
        className={cn(
          'read-meter-edge absolute bottom-0 left-0 h-[2px]',
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
 * ⚠️ THIS IS A TERM OF THE MEASUREMENT, NOT A CAPTION, AND IT MAY NOT BE
 * SHORTENED PAST THE POINT WHERE IT DISTINGUISHES DECOMPRESSED CONTENT FROM
 * BYTES ON THE WIRE. The logs are served gzipped at about 16×, so a `Scanned`
 * reading of 240.2 MB was carried by roughly 15 MB of transfer; drop this
 * sentence and the page overstates bandwidth by a factor of sixteen. The same
 * goes for the throughput clause: end-to-end over a CDN is not a benchmark of
 * the engine, and presenting it as one would put someone else's network under
 * this library's name.
 *
 * It renders immediately below the sticky bar rather than inside it — see the
 * note on `RunStats`. The 1.17 MB WebAssembly figure is a hand-written literal
 * and has to move when the binary does; `docs/BACKLOG.md` points at this file.
 */
export function RunStatsNote() {
  return (
    <p className="text-muted-foreground/70 text-xs leading-relaxed">
      Streamed from a static file, plus a 1.17 MB WebAssembly download once per
      page load. <strong className="font-medium">Scanned</strong> is
      uncompressed log content reaching the search, not bytes on the wire —
      these files are served gzipped at about 16×.{' '}
      <strong className="font-medium">Throughput</strong> is end to end, so it
      measures the network as much as the engine. Every query reads the file to
      its last byte: the last matching line cannot be known before it.
    </p>
  );
}
