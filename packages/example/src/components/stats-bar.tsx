import { sources } from '@/data/logs';
import type { SearchState } from '@/hooks/use-log-search';
import { formatBytes, formatMs } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * One figure and its label, as a cell in the grid below.
 *
 * A `dt`/`dd` pair rather than two spans: these are six name/value pairs, and
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

const ms = (value: number | null) => (value === null ? '—' : formatMs(value));

/**
 * The numbers that make the point.
 *
 * "First match" against "all answered" is the whole argument in two figures: a
 * source that matches early answers as soon as the matching bytes arrive, while
 * a source that does not match cannot answer until it has been read to the end.
 * The gap between the two is the property this library exists for, and with the
 * largest source at a quarter of a gigabyte that gap is now seconds wide rather
 * than milliseconds.
 *
 * The total size of the log files is stated because a query matching nothing
 * has to download every byte of it, and that cost should not be hidden behind a
 * spinner. The WebAssembly figure is stated for the same reason: it is the
 * price of the approach, and a visitor who finds it in devtools rather than
 * here stops trusting the rest of the page.
 *
 * "Scanned" sits beside that total because that pairing is the other half
 * of the argument: 60 MB read out of 408.6 MB is what cancelling a download
 * looks like as a number. It is measured rather than estimated — the page
 * counts bytes through its own `fetch` as they arrive — and it is DECOMPRESSED
 * file content, not traffic: the logs are served gzipped at roughly 16×, so a
 * reader who takes this for bandwidth is wrong by that factor. The copy beside
 * these figures says so, and may not be shortened to the point where it stops
 * saying it.
 *
 * Memory held is still not reported and still cannot be: no browser API gives
 * an honest per-stream figure, so a number there would be a fabrication rather
 * than a measurement.
 */
export function StatsBar({
  state,
  totalLogBytes,
}: {
  state: SearchState;
  totalLogBytes: number;
}) {
  const idle = !state.running && state.answered === 0;

  // A pattern that will not compile answers four times in twenty milliseconds,
  // and every aggregate below is then true and misleading at once: `4/4` and
  // `21ms` under a 400 MB total read as a completed search, not as four
  // refusals. The alert above says what happened; these have nothing to add.
  const uncompiled = state.error !== null;

  return (
    /*
      Six equal columns, not a flex row. Sized by content, a wide label over a
      narrow value — `Sources answered` over `4/4` — leaves a gap the eye reads
      as a mistake, and the six figures never line up with each other or with
      the table below. The note is its own full-width line under a rule for the
      same reason: floated to the right of the figures it set the row's height
      and left half the bar empty.
    */
    <div className="border-border/60 bg-card/40 rounded-xl border backdrop-blur">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-4">
        <Stat label="Log data" value={formatBytes(totalLogBytes)} />
        <Stat
          label="Scanned"
          value={idle || uncompiled ? '—' : formatBytes(state.scannedTotal)}
        />
        <Stat
          label="Matches"
          value={idle || uncompiled ? '—' : `${state.matched}`}
          accent={!uncompiled && state.matched > 0}
        />
        <Stat
          label="Sources answered"
          value={
            uncompiled ? '—' : `${idle ? 0 : state.answered}/${sources.length}`
          }
        />
        <Stat
          label="First match"
          value={uncompiled ? '—' : ms(state.firstMatchMs)}
          accent
        />
        <Stat
          label="All answered"
          value={uncompiled ? '—' : ms(state.allAnsweredMs)}
        />
      </dl>

      <p className="border-border/60 text-muted-foreground/70 border-t px-5 py-2.5 text-xs leading-relaxed">
        Streamed from static files, plus a 1.17 MB WebAssembly download once per
        page load. <strong className="font-medium">Scanned</strong> is
        uncompressed log content reaching the search, not bytes on the wire —
        these files are served gzipped at about 16×. A query that matches
        nothing scans every byte.
      </p>
    </div>
  );
}
