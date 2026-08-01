import { Info } from 'lucide-react';
import { VISIBLE } from '@/data/visible-caveats';

/**
 * Which caveats appear here, and why, is decided in
 * `@/data/visible-caveats` — that module's comment is the record of the
 * curation rule, and `visible-caveats.spec.ts` pins it. This component only
 * renders `VISIBLE`.
 */

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
        {/*
          Composed from Vite's base rather than written as `/docs/`: the site
          sat at `/netgrep/` before the custom domain, and a root-relative link
          would 404 there with nothing to say why. `BASE_URL` always ends in a
          slash.
        */}
        <a
          className="text-primary/90 hover:text-primary underline underline-offset-4"
          href={`${import.meta.env.BASE_URL}docs/#limitations`}
        >
          the documentation
        </a>
        .
      </p>
    </section>
  );
}
