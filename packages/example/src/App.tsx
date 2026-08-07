import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Hero } from '@/components/hero';
import { ResultFeed } from '@/components/result-feed';
import { SearchField } from '@/components/search-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { logUrl, sources } from '@/data/logs';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useGrepStream } from '@/hooks/use-grep-stream';

/**
 * A keystroke starts a read of the whole selected file, so the field is
 * debounced before it reaches the search rather than after.
 */
const DEBOUNCE_MS = 250;

/**
 * What the page arrives searching.
 *
 * Apache is 8 MB — the smallest source — and this is deliberate. The page runs
 * on load, and defaulting that to the 240 MB OpenSSH file would spend a quarter
 * of a gigabyte of a visitor's connection before they had asked for anything.
 * The picker is right there, and a visitor who chooses the big one has
 * demonstrated more to themselves than one who was handed it.
 */
const DEFAULT_SOURCE_ID = 'apache';
const DEFAULT_PATTERN = 'Invalid user';

export function App() {
  // Task 4 replaces this with the source picker's state.
  const source =
    sources.find((candidate) => candidate.id === DEFAULT_SOURCE_ID) ??
    sources[0];

  const [query, setQuery] = useState(DEFAULT_PATTERN);
  const pattern = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const state = useGrepStream(logUrl(source), pattern);

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
        The field stays sticky: it is the page's only control, and a feed that
        fills for seconds is a feed you may have scrolled away from.

        The panel is FULL BLEED, outside the max-width container — constrained
        to the container it ends mid-viewport, leaving a visible vertical seam
        where the blur stops. A gradient fade was tried and is wrong: its
        transparent end lets borders show through the bar.
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

      <div className="mx-auto w-full max-w-6xl px-5 pt-6">
        {state.error && (
          <Alert className="mb-6">
            <CircleAlert />
            <AlertTitle>
              {state.partial
                ? 'The read stopped early — these results are partial'
                : 'That pattern did not compile'}
            </AlertTitle>
            <AlertDescription>
              <code className="font-mono text-xs">{state.error}</code>
            </AlertDescription>
          </Alert>
        )}

        {/*
          The one place the page speaks. Two announcements per run — one when it
          starts, one when it settles. A live region tracking a counter that
          moves every frame would talk over itself for the whole run while
          saying nothing a visitor could act on.
        */}
        <p className="sr-only" role="status">
          {state.running
            ? `Searching ${source.service}.`
            : state.total > 0
              ? `${state.total} matching lines in ${source.service}.`
              : ''}
        </p>

        <ResultFeed state={state} service={source.service} />

        <footer className="text-muted-foreground/60 mt-16 space-y-1.5 text-center text-xs">
          <p>
            Synthetic logs tiled from{' '}
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
