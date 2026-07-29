import { Info } from 'lucide-react';

/**
 * ⚠️ THIS LIST IS PUBLISHED, AND GOES STALE SILENTLY. ⚠️
 *
 * These are the defects the live site tells its visitors about. When one is
 * fixed in the library, DELETE ITS ENTRY HERE IN THE SAME PR — otherwise the
 * page carries on warning the world about a bug that no longer exists, which is
 * worse than saying nothing, because being accurate is the only reason anyone
 * should believe the rest of the page.
 *
 * Nothing enforces this. No test fails and CI stays green.
 *
 *   "Matches spanning two network chunks"  -> BACKLOG 3a
 *   "This demo runs with the cache off"    -> BACKLOG 3b + 18. Fixing BOTH also
 *                                             means re-enabling the cache in
 *                                             use-corpus-search.ts and removing
 *                                             this entry
 *   "Binary files stop at the first NUL"   -> BACKLOG 3f
 *   "One boolean per file"                 -> by design, decision 0003. Stays
 *
 * Backlog 17 (`$` on CRLF input) is deliberately absent: every file in the
 * corpus is LF, so it cannot happen here. Add it if that ever changes.
 *
 * See AGENTS.md §2.3.
 */
const CAVEATS = [
  {
    title: 'One boolean per file',
    body: 'netgrep tells you whether a pattern occurs in a file, not where. No line numbers, match positions, snippets or ranking. If you need those, a prebuilt index — Pagefind, Lunr, FlexSearch — is the right tool.',
  },
  {
    title: 'Matches spanning two network chunks are missed',
    body: 'Each fetch chunk is searched on its own, so a pattern straddling the seam between two of them is not found. Which chunk a match lands in depends on how the network split the response, so the same query can behave differently twice. Live on this page.',
  },
  {
    title: 'This demo runs with the cache off',
    body: 'netgrep can hold downloaded bytes in memory, and does by default. Two open defects make that unsafe for a page taking one query after another, so the demo disables it and re-reads the corpus each time — 2.6 MB, served from the browser cache on repeats.',
  },
  {
    title: 'Binary files stop at the first NUL',
    body: "ripgrep's binary detection quits on a NUL byte, and a boolean cannot distinguish “binary, not searched” from “no match”. Plain text — the intended use — is unaffected.",
  },
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
        {CAVEATS.map((caveat) => (
          <div key={caveat.title}>
            <dt className="text-foreground font-medium">{caveat.title}</dt>
            <dd className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              {caveat.body}
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
          href="https://github.com/dgopsq/netgrep#known-limitations"
        >
          the README
        </a>
        .
      </p>
    </section>
  );
}
