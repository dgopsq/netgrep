import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const REPO = 'https://github.com/dgopsq/netgrep';

export function Hero() {
  return (
    <header className="flex flex-col items-center pt-20 pb-10 text-center sm:pt-28">
      <Badge
        variant="outline"
        className="border-border/80 mb-6 gap-1.5 rounded-full px-3 py-1"
      >
        <span className="bg-primary size-1.5 rounded-full" aria-hidden="true" />
        An experiment, not a recommendation
      </Badge>

      <h1 className="font-mono text-5xl font-semibold tracking-tight sm:text-6xl">
        <span className="text-muted-foreground/60">new </span>
        <span className="text-gradient">Netgrep</span>
        <span className="text-primary">()</span>
        <span className="text-muted-foreground/60">;</span>
      </h1>

      <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed text-balance">
        ripgrep's search engine, compiled to WebAssembly, searching remote files{' '}
        <em className="text-foreground not-italic">while they download</em> —
        answering the moment it sees a match, instead of waiting for the file.
      </p>

      <p className="text-muted-foreground/70 mt-4 max-w-2xl text-sm leading-relaxed text-balance">
        A prebuilt index — Pagefind, Lunr, FlexSearch — is usually smaller,
        faster and far more capable. It can rank, snippet and locate matches;
        netgrep does none of that. It returns one boolean per file. What this
        explores is whether the real engine can usefully run over HTTP.
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
