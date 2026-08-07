import { sources } from '@/data/logs';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Ties the visible label to the radio group as its accessible name. */
const LABEL_ID = 'source-picker-label';

/**
 * Which log is being grepped, one at a time.
 *
 * The sizes are on the tags because the sizes are the demonstration: reading
 * `8.3 MB` beside `240.2 MB` and watching the same pattern take thirty times as
 * long is an argument the visitor performs rather than reads. Four concurrent
 * reads were rejected — unattributable, and 400 MB of someone's connection.
 */
export function SourcePicker({
  value,
  onChange,
  bytes,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Real sizes from the generated manifest, keyed by source id. */
  bytes: Record<string, number>;
}) {
  return (
    // The visible label is what separates this from the suggestion chips above:
    // both are rows of pills, and an unlabelled one reads as more of the same
    // list. `aria-labelledby` reuses that text instead of an `aria-label` only a
    // screen reader would hear.
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span id={LABEL_ID} className="text-muted-foreground/70 mr-1 text-xs">
        Search in
      </span>

      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-labelledby={LABEL_ID}
      >
        {sources.map((source) => {
          const selected = source.id === value;

          return (
            // A real radio rather than a button wearing `role="radio"`: the
            // native input is what makes the group one tab stop with arrow keys
            // between the four, which a styled button must reimplement.
            <label
              key={source.id}
              className={cn(
                'focus-within:ring-ring inline-flex cursor-pointer items-baseline gap-1.5 rounded-lg border px-3 py-1.5 transition-colors focus-within:ring-2',
                selected
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/80 bg-card/60 text-muted-foreground hover:border-primary/40 hover:text-primary',
              )}
            >
              {/* `sr-only` is absolutely positioned, so the radio sits outside
                  this flex row. */}
              <input
                type="radio"
                name="log-source"
                value={source.id}
                checked={selected}
                onChange={() => onChange(source.id)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{source.service}</span>
              <span className="font-mono text-[11px] tabular-nums opacity-70">
                {formatBytes(bytes[source.id] ?? source.targetBytes)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
