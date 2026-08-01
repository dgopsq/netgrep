import { CAVEATS } from './caveats.generated';

/** The rendered shape: what `<Limitations>`'s `<dl>` actually iterates. */
export type VisibleCaveat = {
  id: string;
  title: string;
  demoBody: string;
};

/**
 * WHAT THE DEMO PAGE TELLS VISITORS IT CANNOT DO.
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
 *
 * This lives in its own `.ts` module, not inline in `limitations.tsx`,
 * because the curation rule above is exactly what `visible-caveats.spec.ts`
 * pins: in a `.tsx` file it could only be tested by rendering React, but as a
 * plain module `VISIBLE` is a pure value a test can assert against directly.
 */
const DEMO_CAVEATS: VisibleCaveat[] = [
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
export const VISIBLE: VisibleCaveat[] = [
  ...CAVEATS.filter(
    (caveat) => caveat.kind === 'by-design' || caveat.demoCorpusCanTrigger,
  ).map((caveat) => ({
    id: caveat.id,
    title: caveat.title,
    demoBody: caveat.demoBody ?? caveat.short,
  })),
  ...DEMO_CAVEATS,
];
