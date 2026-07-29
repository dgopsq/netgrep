import { Info } from 'lucide-react';

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

      <div className="flex items-start gap-3 pt-10">
        <Info
          className="text-primary/80 mt-1 size-5 shrink-0"
          aria-hidden="true"
        />
        <div>
          <h2
            id="limitations-heading"
            className="text-xl font-medium tracking-tight"
          >
            Scope
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
            What netgrep does, and what it deliberately does not. Worth knowing
            before you build on it.
          </p>
        </div>
      </div>

      <dl className="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-2">
        {CAVEATS.map((caveat) => (
          <div key={caveat.title}>
            <dt className="text-foreground text-sm font-medium">
              {caveat.title}
            </dt>
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
