import { sources } from '@/data/logs';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Ties the visible label to the radio group as its accessible name. */
const LABEL_ID = 'source-picker-label';

/**
 * Which log is being grepped.
 *
 * ONE SOURCE AT A TIME, and the sizes are on the buttons because the sizes are
 * the demonstration. Reading `8.3 MB` beside `240.2 MB` and then watching the
 * same pattern take thirty times as long is the argument the old four-row table
 * made statically; here the visitor performs it.
 *
 * Four concurrent reads were considered and rejected — a feed interleaving four
 * files cannot be read or attributed, and it is 400 MB of someone's connection.
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
    // THE VISIBLE LABEL IS WHAT SEPARATES THIS FROM THE SUGGESTION CHIPS ABOVE.
    // Both are a row of pills; the chips carry a "Try" and this row carried
    // nothing, so the eye read it as more of the same list rather than as a
    // different control. Labelling both makes each row say what it is, and
    // `aria-labelledby` points the group at that same visible text rather than
    // repeating it in an `aria-label` only a screen reader would ever hear.
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
            // A REAL RADIO, VISUALLY HIDDEN, RATHER THAN A BUTTON WEARING
            // `role="radio"`. The native input is what makes the group one tab
            // stop with arrow keys moving between the four — behaviour a styled
            // button would have to reimplement, and usually does not.
            <label
              key={source.id}
              className={cn(
                'focus-within:ring-ring cursor-pointer rounded-lg border px-3 py-1.5 text-left transition-colors focus-within:ring-2',
                selected
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/80 bg-card/60 text-muted-foreground hover:border-primary/40 hover:text-primary',
              )}
            >
              <input
                type="radio"
                name="log-source"
                value={source.id}
                checked={selected}
                onChange={() => onChange(source.id)}
                className="sr-only"
              />
              <span className="block text-sm leading-tight font-medium">
                {source.service}
              </span>
              <span className="block font-mono text-[11px] leading-tight tabular-nums opacity-70">
                {formatBytes(bytes[source.id] ?? source.targetBytes)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
