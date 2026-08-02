import { LoaderCircle, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Queries worth trying, chosen to teach something rather than to look busy.
 *
 * Each one demonstrates a different thing about the search. The first two show
 * where a match sits in the file, which is what the elapsed times below make
 * visible; the middle two show that the pattern reaches ripgrep as a regex
 * rather than as a substring; the last one matches nothing anywhere, which is
 * the case that has to read all four sources to the last byte — the expensive
 * end of the argument, and worth offering rather than hiding.
 *
 * The generated logs tile a fixed sample, so anything drawn from the sample
 * recurs near the head of its file. The `NETGREP-MARKER-*` lines are the
 * exception: the generator injects them at fixed fractions of each file, and
 * they are the only way to ask for a match that is genuinely deep.
 */
const SUGGESTIONS = [
  { pattern: 'Invalid user', hint: 'OpenSSH, near the head of the file' },
  { pattern: 'NETGREP-MARKER-75', hint: 'one line, three quarters in' },
  { pattern: 'Exception|BREAK-IN', hint: 'alternation, across two services' },
  { pattern: 'sshd\\[[0-9]+\\]: Failed', hint: 'a real regex' },
  { pattern: 'kernel panic', hint: 'no match — reads all four to the end' },
];

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  running: boolean;
};

export function SearchField({ value, onChange, running }: SearchFieldProps) {
  return (
    <div className="w-full">
      <div className="relative">
        {/*
          `z-10` is load-bearing: the input follows this icon in the DOM and
          paints its own translucent background over it, which leaves the
          magnifier as a barely visible smudge rather than an icon.
        */}
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2"
          aria-hidden="true"
        />

        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Grep the log sources — Invalid user, BREAK-IN, an IP…"
          aria-label="Search the log sources with a ripgrep pattern"
          // This is the page's only interactive control, so focusing it takes
          // focus from nothing.
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          className={cn(
            'h-14 rounded-xl pr-12 pl-11 font-mono text-base md:text-base',
            'bg-card/60 border-border/80 backdrop-blur',
            // Chromium draws its own clear button for `type="search"`, in the
            // exact spot the running indicator occupies.
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />

        {running && (
          <LoaderCircle
            className="text-primary absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin"
            aria-label="Searching"
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground/70 mr-1 text-xs">Try</span>

        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.pattern}
            type="button"
            onClick={() => onChange(suggestion.pattern)}
            title={suggestion.hint}
            className="rounded-md focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
          >
            <Badge
              variant={value === suggestion.pattern ? 'default' : 'outline'}
              className={cn(
                'hover:border-primary/40 hover:text-primary cursor-pointer border-border/80 font-mono transition-colors',
                value === suggestion.pattern && 'border-transparent',
              )}
            >
              {suggestion.pattern}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
