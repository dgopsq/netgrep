import { stories, totalBytes } from '@/data/stories';
import type { SearchState } from '@/hooks/use-corpus-search';
import { formatBytes } from '@/lib/story-url';
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
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          'font-mono text-lg leading-none tabular-nums',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground/70 text-[11px] tracking-wide uppercase">
        {label}
      </span>
    </div>
  );
}

const ms = (value: number | null) =>
  value === null ? '—' : `${Math.round(value)} ms`;

/**
 * The numbers that make the point.
 *
 * "First match" against "all resolved" is the whole argument in two figures: a
 * file that matches early answers as soon as the matching bytes arrive, while a
 * file that does not match cannot answer until it has been read to the end. The
 * gap between the two is the early-resolution property (decision 0002).
 *
 * The corpus total is stated because a query matching nothing has to download
 * every byte of it, and that cost should not be hidden behind a spinner. The
 * WebAssembly figure is stated for the same reason: it is the price of the
 * approach, and a visitor who finds it in devtools rather than here stops
 * trusting the rest of the page.
 */
export function StatsBar({ state }: { state: SearchState }) {
  const idle = !state.running && state.resolved === 0;

  return (
    <div className="border-border/60 bg-card/40 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border px-5 py-4 backdrop-blur">
      <Stat
        label="Matches"
        value={idle ? '—' : `${state.matched}`}
        accent={state.matched > 0}
      />
      <Stat
        label="Files answered"
        value={
          idle ? `${stories.length}` : `${state.resolved}/${stories.length}`
        }
      />
      <Stat label="First match" value={ms(state.firstMatchMs)} accent />
      <Stat label="All answered" value={ms(state.completedMs)} />

      <p className="text-muted-foreground/70 ml-auto max-w-xs text-xs leading-relaxed">
        {formatBytes(totalBytes)} of text across {stories.length} files, plus a
        1.17 MB WebAssembly download once per page load. A query that matches
        nothing reads all of it.
      </p>
    </div>
  );
}
