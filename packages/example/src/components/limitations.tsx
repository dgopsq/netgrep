import { TriangleAlert } from 'lucide-react';

const CAVEATS = [
  {
    title: 'A match spanning two network chunks is missed',
    body: 'Each fetch chunk is searched on its own, so a pattern that straddles the seam between two of them is never found. It is silent, and it depends on how the network split the response rather than on anything you typed — so the same query can behave differently twice. This one is live on this page.',
  },
  {
    title: 'The result is a boolean, and nothing more',
    body: 'No line numbers, no match positions, no snippets, no ranking. The cards above can tell you that a story contains your pattern; they cannot tell you where, how often, or show you the line.',
  },
  {
    title: 'The in-memory cache is switched off here',
    body: 'Leaving it on would make this page answer wrongly. Resolving early leaves the cache holding only the prefix that was read, so a later query for a term further down the same file gets a confident false; and two searches of one file started together append it to itself. Both are documented defects, so the demo runs with the cache disabled and re-reads the corpus each time.',
  },
  {
    title: 'A NUL byte discards the rest of its chunk',
    body: "ripgrep's binary detection quits on a NUL, and the boolean API cannot distinguish “binary, not searched” from “no match”. The plain-text corpus here never triggers it; your files might.",
  },
];

export function Limitations() {
  return (
    <section className="mt-20" aria-labelledby="limitations-heading">
      <div className="hairline-top h-px w-full" />

      <div className="flex items-start gap-3 pt-10">
        <TriangleAlert
          className="text-primary/80 mt-1 size-5 shrink-0"
          aria-hidden="true"
        />
        <div>
          <h2
            id="limitations-heading"
            className="text-xl font-medium tracking-tight"
          >
            Known limitations
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
            These are real, present in the published package, and documented
            rather than fixed. They are listed here for the same reason they are
            listed in the README: this is a demonstration of an idea, not
            infrastructure.
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
        The full list, with the tests that pin each one, is in{' '}
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
