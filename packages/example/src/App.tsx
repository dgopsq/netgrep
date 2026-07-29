import { CircleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { Hero } from '@/components/hero';
import { Limitations } from '@/components/limitations';
import { SearchField } from '@/components/search-field';
import { StatsBar } from '@/components/stats-bar';
import { StoryCard } from '@/components/story-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCorpusSearch, useOrderedStories } from '@/hooks/use-corpus-search';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useFlip } from '@/hooks/use-flip';

/**
 * Every keystroke starts 56 downloads, so the field is debounced before it
 * reaches the search rather than after.
 */
const DEBOUNCE_MS = 250;

export function App() {
  const [query, setQuery] = useState('');
  const pattern = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const state = useCorpusSearch(pattern);
  const ordered = useOrderedStories(state.order);
  const gridRef = useRef<HTMLUListElement>(null);

  useFlip(gridRef, state.order);

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
        The field stays reachable while scrolling 56 cards.

        Two things here are deliberate. A gradient fade was tried first and is
        wrong: its transparent end lets card borders show through the bar, so
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
        A pattern that will not compile is reported once per file, so 56
        identical failures would otherwise fill the grid. The message is the
        regex crate's own diagnostic, surfaced through the `Result` that
        `search_bytes` returns.
      */}
        {state.error && (
          <Alert variant="destructive" className="mb-6">
            <CircleAlert />
            <AlertTitle>That pattern did not compile</AlertTitle>
            <AlertDescription>
              <code className="font-mono text-xs">{state.error}</code>
            </AlertDescription>
          </Alert>
        )}

        <StatsBar state={state} />

        <ul
          ref={gridRef}
          className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {ordered.map((story) => (
            <li key={story.id} data-flip-id={story.id}>
              <StoryCard
                story={story}
                status={state.statuses[story.id] ?? 'idle'}
              />
            </li>
          ))}
        </ul>

        <Limitations />

        <footer className="text-muted-foreground/60 mt-16 text-center text-xs">
          Corpus: the Sherlock Holmes canon, public domain, from{' '}
          <a
            className="hover:text-primary underline underline-offset-4"
            href="https://sherlock-holm.es/"
          >
            sherlock-holm.es
          </a>
          .
        </footer>
      </div>
    </div>
  );
}
