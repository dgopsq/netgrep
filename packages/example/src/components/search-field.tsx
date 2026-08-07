import { LoaderCircle, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Queries worth trying, chosen to teach something rather than to look busy.
 *
 * THE OLD RULE HERE — "every suggestion matches something" — IS RETIRED, AND
 * ITS PREMISE IS WHY. It existed because a zero-match query read all four
 * sources to their last byte, so offering one as a chip spent hundreds of
 * megabytes to show a row of dashes. Under enumeration there is no early exit
 * for it to be expensive relative to: `grep` yields every matching line, the
 * last of which cannot be known before the last byte, so a query matching
 * nothing costs exactly what a query matching everything costs. The chip that
 * matches nothing is now the cheapest honest way to show what a full read
 * costs, which is the other half of the page's argument.
 *
 * The generated logs tile a fixed sample, so anything drawn from the sample
 * recurs near the head of its file — and, being tiled, recurs tens of thousands
 * of times, which is what fills the feed. The `NETGREP-MARKER-<pct>` lines are
 * the exception: the generator injects them at 25%, 50%, 75% and 99% of every
 * file, so each is exactly ONE line, and finding it is proof the read reached
 * that depth.
 *
 * Every pattern here is valid against every source, because the picker can
 * change under a chip that is already selected. A hint naming one service would
 * be wrong as soon as it did.
 */
const SUGGESTIONS = [
  { pattern: 'error', hint: 'smart case — lowercase matches any case' },
  { pattern: 'NETGREP-MARKER-75', hint: 'one line, three quarters in' },
  {
    pattern: 'Exception|BREAK-IN',
    hint: 'alternation — this reaches ripgrep as a regex',
  },
  {
    pattern: 'zzz-no-such-line',
    hint: 'matches nothing: the whole file, read to the last byte',
  },
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
          placeholder="Grep this log — Invalid user, BREAK-IN, an IP…"
          aria-label="Grep the selected log file with a ripgrep pattern"
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
