import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Hero } from '@/components/hero';
import { LogPanel, LogPanelHeader } from '@/components/log-panel';
import { SearchField } from '@/components/search-field';
import { StatsBar } from '@/components/stats-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { sources } from '@/data/logs';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLogSearch } from '@/hooks/use-log-search';

/**
 * Every keystroke starts four downloads totalling hundreds of megabytes, so the
 * field is debounced before it reaches the search rather than after.
 */
const DEBOUNCE_MS = 250;

export function App() {
  const [query, setQuery] = useState('');
  const pattern = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const state = useLogSearch(pattern);

  return (
    <div className="relative pb-24">
      {/*
        Decorative only. Absolutely positioned rather than a `body` background
        so that it scrolls away with the hero — see the `hero-glow` comment in
        index.css for why that matters to the sticky bar below.
      */}
      <div
        className="hero-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-[46rem]"
        aria-hidden="true"
      />

      <div className="mx-auto w-full max-w-6xl px-5">
        <Hero />
      </div>

      {/*
        The field stays sticky. Four panels no longer scroll past it the way 56
        cards did, but the field is still the page's only control and a search
        that runs for seconds is a search you may have scrolled away from.

        Two things here are deliberate. A gradient fade was tried first and is
        wrong: its transparent end lets panel borders show through the bar, so
        rows appear to slide over the chips. And the panel is FULL BLEED,
        outside the max-width container — constrained to the container it ends
        mid-viewport, leaving a visible vertical seam where the blur stops.
      */}
      <div className="bg-background sticky top-0 z-20">
        <div className="mx-auto w-full max-w-6xl px-5 pt-4 pb-5">
          <SearchField
            value={query}
            onChange={setQuery}
            running={state.running}
          />
        </div>
        <div className="hairline-top absolute inset-x-0 bottom-0 h-px" />
      </div>

      {/*
        `pt-6` separates the content from the sticky bar's bottom hairline.
        Without it the stats panel's own border sits directly against that rule
        and reads as one heavy double line.
      */}
      <div className="mx-auto w-full max-w-6xl px-5 pt-6">
        {/*
          A pattern that will not compile is reported once per source, so
          without this the list would carry four copies of the same complaint.
          The message is the regex crate's own diagnostic, surfaced through the
          `Result` that `search_bytes` returns.
        */}
        {state.error && (
          <Alert className="mb-6">
            <CircleAlert />
            <AlertTitle>That pattern did not compile</AlertTitle>
            <AlertDescription>
              <code className="font-mono text-xs">{state.error}</code>
            </AlertDescription>
          </Alert>
        )}

        <StatsBar state={state} />

        {/*
          The panels are listed smallest source first and never reorder. That
          order is the demonstration: reading down the column of elapsed times
          against the column of sizes is how a visitor sees that answering is
          paced by bytes read, not by file count. Sorting by who answered first
          would scramble exactly that pairing.
        */}
        <div className="mt-6">
          <LogPanelHeader />

          <ul className="space-y-1.5">
            {sources.map((source) => (
              <li key={source.id}>
                <LogPanel
                  source={source}
                  status={state.statuses[source.id] ?? 'idle'}
                  line={state.lines[source.id]}
                  elapsedMs={state.elapsedMs[source.id]}
                />
              </li>
            ))}
          </ul>
        </div>

        <footer className="text-muted-foreground/60 mt-16 space-y-1.5 text-center text-xs">
          <p>
            Corpus: synthetic logs tiled from{' '}
            <a
              className="hover:text-primary underline underline-offset-4"
              href="https://zenodo.org/records/8275861"
            >
              loghub-2.0
            </a>{' '}
            samples (Apache, ZooKeeper, Hadoop, OpenSSH),{' '}
            <a
              className="hover:text-primary underline underline-offset-4"
              href="https://creativecommons.org/licenses/by/4.0/"
            >
              CC BY 4.0
            </a>
            .
          </p>

          <p>
            What netgrep{' '}
            {/*
              Composed from Vite's base rather than written as `/docs/`: the
              site sat at `/netgrep/` before the custom domain, and a
              root-relative link would 404 there with nothing to say why.
              `BASE_URL` always ends in a slash.
            */}
            <a
              className="hover:text-primary underline underline-offset-4"
              href={`${import.meta.env.BASE_URL}docs/#limitations`}
            >
              cannot do
            </a>{' '}
            is listed in the documentation.
          </p>
        </footer>
      </div>
    </div>
  );
}
