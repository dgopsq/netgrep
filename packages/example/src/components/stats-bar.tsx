import { sources } from '@/data/logs';
import type { SearchState } from '@/hooks/use-log-search';
import { formatBytes, formatMs } from '@/lib/format';
import { cn } from '@/lib/utils';

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
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground/60 text-[10px] leading-none tracking-wider uppercase">
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-lg leading-none tabular-nums',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </span>
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
 * The corpus total is stated because a query matching nothing has to download
 * every byte of it, and that cost should not be hidden behind a spinner. The
 * WebAssembly figure is stated for the same reason: it is the price of the
 * approach, and a visitor who finds it in devtools rather than here stops
 * trusting the rest of the page.
 *
 * Nothing here reports bytes read or memory held. Neither is measurable from
 * this page — the library exposes no progress and the browser exposes no honest
 * per-stream figure — so the dashboard reports what it can actually time.
 */
export function StatsBar({
  state,
  corpusBytes,
}: {
  state: SearchState;
  corpusBytes: number;
}) {
  const idle = !state.running && state.answered === 0;

  // A pattern that will not compile answers four times in twenty milliseconds,
  // and every aggregate below is then true and misleading at once: `4/4` and
  // `21ms` under a 400 MB corpus figure read as a completed search, not as four
  // refusals. The alert above says what happened; these have nothing to add.
  const uncompiled = state.error !== null;

  return (
    <div className="border-border/60 bg-card/40 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border px-5 py-3.5 backdrop-blur">
      <Stat label="Corpus" value={formatBytes(corpusBytes)} />
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

      <p className="text-muted-foreground/70 ml-auto max-w-xs text-xs leading-relaxed">
        Streamed from static files, plus a 1.17 MB WebAssembly download once per
        page load. A query that matches nothing reads every byte.
      </p>
    </div>
  );
}
