import { LoaderCircle, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Queries worth trying, chosen to teach something rather than to look busy.
 *
 * THE OLD "every suggestion matches something" RULE IS RETIRED because its
 * premise is void: a zero-match query used to read all four sources to the last
 * byte, but under enumeration every query does, so it now costs no more than
 * any other. `zzz-no-such-line` is the cheapest honest way to show a full read.
 *
 * The logs tile a fixed sample, so anything from it recurs tens of thousands of
 * times — which is what fills the feed. `NETGREP-MARKER-<pct>` is the
 * exception: injected once each at 25%, 50%, 75% and 99%, so finding one proves
 * the read reached that depth.
 *
 * Every pattern must be valid against every source, since the picker can change
 * under a selected chip.
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
          placeholder="Grep this log — error, File does not exist, an IP…"
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
