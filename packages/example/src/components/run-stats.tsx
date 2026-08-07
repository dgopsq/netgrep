import type { GrepStreamState } from '@/hooks/use-grep-stream';
import { formatBytes, formatMs, formatThroughput } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * One figure and its label, as a cell in the grid below.
 *
 * A `dt`/`dd` pair rather than two spans: these are five name/value pairs, and
 * the markup may as well say so — a screen reader then reads "first match,
 * 27ms" instead of two unrelated strings.
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
    <div className="min-w-0">
      <dt className="text-muted-foreground/60 truncate text-[10px] leading-none tracking-wider uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1.5 font-mono text-lg leading-none tabular-nums',
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
 * The 1.17 MB WebAssembly figure lives in the note and has to move when the
 * binary does — `docs/BACKLOG.md` points at this file for it.
 */
export function RunStats({ state }: { state: GrepStreamState }) {
  // A pattern that will not compile fails in milliseconds having read nothing,
  // and every figure below is then true and misleading at once: `0` and `3ms`
  // read as a completed search rather than as a refusal. The alert above says
  // what happened; these have nothing to add.
  const uncompiled = state.error !== null && !state.partial;

  const dash = (value: string) => (uncompiled ? '—' : value);

  return (
    <div className="border-border/60 bg-card/40 rounded-xl border px-5 py-4 backdrop-blur">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-4">
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

      <p className="border-border/60 text-muted-foreground/70 mt-4 border-t pt-2.5 text-xs leading-relaxed">
        Streamed from a static file, plus a 1.17 MB WebAssembly download once
        per page load. <strong className="font-medium">Scanned</strong> is
        uncompressed log content reaching the search, not bytes on the wire —
        these files are served gzipped at about 16×.{' '}
        <strong className="font-medium">Throughput</strong> is end to end, so it
        measures the network as much as the engine. Every query reads the file
        to its last byte: the last matching line cannot be known before it.
      </p>
    </div>
  );
}
