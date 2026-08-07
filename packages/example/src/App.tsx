import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Hero } from '@/components/hero';
import { ResultFeed } from '@/components/result-feed';
import { RunStats, RunStatsNote } from '@/components/run-stats';
import { ScanMeterBar } from '@/components/scan-meter-bar';
import { SearchField } from '@/components/search-field';
import { SourcePicker } from '@/components/source-picker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { logUrl, sources } from '@/data/logs';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useGrepStream } from '@/hooks/use-grep-stream';
import { useLogSizes } from '@/hooks/use-log-sizes';

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
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID);
  const [query, setQuery] = useState(DEFAULT_PATTERN);

  const sizes = useLogSizes();
  const source =
    sources.find((candidate) => candidate.id === sourceId) ?? sources[0];
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
        The controls and the figures stay sticky, and the feed below them is
        scrolled by the WINDOW — one scrollbar on the page, not a scroller
        nested in a scroller. What is worth sticking is whatever changes during
        a run or steers it: the field, the source picker, the five figures and
        the read meter. Everything below is the result, and results scroll.

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

          {/*
            Even spacing with the chips above, because the SourcePicker's own
            "Search in" label is what distinguishes the two rows now. An earlier
            revision pushed them apart instead and it bought nothing once both
            rows said what they were — a labelled row does not also need to be
            held at arm's length.
          */}
          <div className="mt-3">
            <SourcePicker
              value={source.id}
              onChange={setSourceId}
              bytes={sizes.bytes}
            />
          </div>

          {/*
            The figures are sticky WITH the controls, and that is the point of
            the arrangement: every one of them moves while the feed streams
            past, so a visitor who has scrolled a thousand rows down can still
            watch `Elapsed` climb against a `First match` that settled in
            milliseconds — which is the page's whole argument, and was
            previously visible only from the top of the document.

            Only the VALUES are up here. The prose qualifying them is static for
            the whole run and rides below the bar as `RunStatsNote`, because a
            sticky header is paid for in feed nobody gets to see.
          */}
          <div className="mt-3">
            <RunStats state={state} />
          </div>

          <ScanMeterBar
            bytesRead={state.bytesRead}
            totalBytes={sizes.bytes[source.id] ?? source.targetBytes}
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

        {/*
          Directly under the sticky bar, so it sits with the figures it
          qualifies on first paint — which is when it is read — and scrolls away
          once the visitor is reading results instead of reading about them.
        */}
        <div className="mb-5">
          <RunStatsNote />
        </div>

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
