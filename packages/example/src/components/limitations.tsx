import { Info } from 'lucide-react';
import { CAVEATS } from '@/data/caveats.generated';

/**
 * WHAT THIS PAGE TELLS VISITORS IT CANNOT DO.
 *
 * The library's caveats are no longer typed here: they come from
 * `docs/guide/caveats.data.json` via `pnpm docs:sync`, which also writes the
 * README's list and the guide's Limitations page. Fixing a defect means
 * deleting ONE entry from that file — CI fails if the three surfaces disagree.
 *
 * Two things are still decided HERE, and both are deliberate:
 *
 * 1. `demoCorpusCanTrigger` filters the library's defects. `$` on CRLF (17)
 *    and the 64 KB line ceiling (3g) are excluded because this corpus is all
 *    LF and its longest line is 76 bytes. An unreachable caveat dilutes a list
 *    whose whole value is that every entry is live.
 *
 * 2. DEMO_CAVEATS below are not library caveats at all. They describe this
 *    page, no library fix retires them, and they must never move into the
 *    shared data file.
 *
 * Do not delete a caveat to tidy the page. The list is short because the
 * defects are few. See AGENTS.md §2.3.
 */
const DEMO_CAVEATS = [
  {
    id: 'cache-off',
    title: 'This demo runs with the cache off',
    demoBody:
      'netgrep can hold downloaded bytes in memory, and does by default. The demo turns it off so the timings above keep measuring the network rather than a warm buffer — searching while downloading is the thing this page exists to show. It re-reads the corpus each time: 2.6 MB, served from the browser cache on repeats.',
  },
];

/**
 * `demoBody` rather than `short`: `short` is a one-line README bullet, and the
 * cards are the page's explanation of what it cannot do. `demoBody` is plain
 * text for the same reason — it is rendered into a `<dd>`, so markdown in it
 * would show up as literal backticks.
 */
const VISIBLE = [
  ...CAVEATS.filter(
    (caveat) => caveat.kind === 'by-design' || caveat.demoCorpusCanTrigger,
  ).map((caveat) => ({
    id: caveat.id,
    title: caveat.title,
    demoBody: caveat.demoBody ?? caveat.short,
  })),
  ...DEMO_CAVEATS,
];

export function Limitations() {
  return (
    <section className="mt-20" aria-labelledby="limitations-heading">
      <div className="hairline-top h-px w-full" />

      {/*
        The heading is flush with the definition list below it, not indented
        behind an icon: indented, it lined up with nothing and read as another
        list item rather than as the start of a section. The eyebrow carries the
        teal accent the icon used to, without pushing the title off the grid.
      */}
      <div className="pt-14">
        <p className="text-primary/90 flex items-center gap-2 text-xs font-medium tracking-[0.2em] uppercase">
          <Info className="size-3.5" aria-hidden="true" />
          Scope
        </p>

        <h2
          id="limitations-heading"
          className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-balance"
        >
          What netgrep does, and what it deliberately does not
        </h2>

        <p className="text-muted-foreground mt-3 max-w-xl leading-relaxed">
          Worth knowing before you build on it.
        </p>
      </div>

      <dl className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {VISIBLE.map((caveat) => (
          <div key={caveat.id}>
            <dt className="text-foreground font-medium">{caveat.title}</dt>
            <dd className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              {caveat.demoBody}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-muted-foreground/70 mt-9 text-sm">
        Every known defect is tracked and pinned by a test, in{' '}
        <a
          className="text-primary/90 hover:text-primary underline underline-offset-4"
          href="https://github.com/dgopsq/netgrep/blob/main/docs/BACKLOG.md"
        >
          docs/BACKLOG.md
        </a>{' '}
        and{' '}
        <a
          className="text-primary/90 hover:text-primary underline underline-offset-4"
          href="/docs/#limitations"
        >
          the documentation
        </a>
        .
      </p>
    </section>
  );
}
