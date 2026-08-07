import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const REPO = 'https://github.com/dgopsq/netgrep';

export function Hero() {
  return (
    <header className="flex flex-col items-center pt-20 pb-10 text-center sm:pt-28">
      {/*
        The lead line names the category before the property, and the accent
        carries the capability rather than the timing — the timing is what the
        grid below demonstrates, file by file. Constant memory is not itself
        rare: a hand-written fetch loop feeding a per-chunk RegExp holds memory
        flat too. Doing it with ripgrep's engine is the part nothing else in a
        tab offers. The hedges that used to open this page are not gone — they
        are on the limitations page, where they inform rather than deter.
      */}
      <Badge
        variant="outline"
        className="border-border/80 mb-6 gap-1.5 rounded-full px-3 py-1"
      >
        <span className="bg-primary size-1.5 rounded-full" aria-hidden="true" />
        ripgrep's real engine, running in this tab
      </Badge>

      <h1 className="font-mono text-5xl font-semibold tracking-tight sm:text-6xl">
        <span className="text-muted-foreground/60">new </span>
        <span className="text-gradient">Netgrep</span>
        <span className="text-primary">()</span>
        <span className="text-muted-foreground/60">;</span>
      </h1>

      <p className="text-foreground/90 mt-6 max-w-2xl text-xl leading-relaxed text-balance sm:text-2xl">
        grep over HTTP,{' '}
        <em className="text-primary not-italic">
          on files your tab could never hold
        </em>
        .
      </p>

      <p className="text-muted-foreground mt-4 max-w-xl leading-relaxed text-balance">
        ripgrep's real regex engine over a streaming fetch. Matching lines
        arrive while the file is still downloading — each with its line number,
        none of it held in memory. No index to build, no backend to run.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2 text-sm">
        <a
          href={REPO}
          className="border-border/80 bg-card/60 hover:border-primary/40 hover:text-primary inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 transition-colors"
        >
          Source on GitHub
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
        <a
          href="https://www.npmjs.com/package/@netgrep/netgrep"
          className="border-border/80 bg-card/60 hover:border-primary/40 hover:text-primary inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 font-mono transition-colors"
        >
          @netgrep/netgrep
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </header>
  );
}
