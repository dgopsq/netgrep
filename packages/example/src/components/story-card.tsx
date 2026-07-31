import { Check, TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import { Card } from '@/components/ui/card';
import type { Story } from '@/data/stories';
import type { StoryStatus } from '@/hooks/use-corpus-search';
import { formatBytes } from '@/lib/story-url';
import { cn } from '@/lib/utils';

type StoryCardProps = {
  story: Story;
  status: StoryStatus;
  /** The first matching line, when this story matched. */
  line?: string;
};

/**
 * One file in the corpus.
 *
 * Memoised: a search updates state 56 times in quick succession, and without
 * this every update would re-render all 56 cards rather than the one that
 * changed.
 */
export const StoryCard = memo(function StoryCard({
  story,
  status,
  line,
}: StoryCardProps) {
  const isMatch = status === 'match';
  const isMiss = status === 'miss';
  const isSearching = status === 'searching';
  const isError = status === 'error';

  return (
    <Card
      className={cn(
        // Explicitly NOT `transition-all`: that includes `transform`, which the
        // FLIP reorder animates directly, so the two fight and the glide stutters.
        'relative gap-0 overflow-hidden duration-300',
        // Fill the grid cell. The `li` stretches to the row's height on its own,
        // but the card inside it does not, so a match carrying a line made its
        // whole row taller while every miss in that row stayed at content height
        // — leaving them floating in a gap and reading as further faded than the
        // 35% opacity below actually makes them.
        'h-full',
        'transition-[opacity,border-color,background-color,box-shadow]',
        isMatch &&
          'border-primary/40 bg-primary/[0.06] shadow-[0_0_0_1px_var(--color-primary)/10,0_8px_30px_-12px_var(--color-primary)]',
        // Misses recede rather than disappear: the point of the grid is that
        // you can see every file being answered, not just the hits.
        isMiss && 'opacity-35',
        isError && 'border-destructive/40 bg-destructive/[0.06]',
      )}
    >
      {/*
        The progress hairline. It is not a real progress bar — the library
        reports no byte counts — it is an indeterminate sweep that says "this
        file is being read right now", which is the thing worth seeing.
      */}
      {isSearching && (
        <span className="bg-primary/70 absolute inset-x-0 top-0 h-px animate-pulse" />
      )}

      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <span
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
            isMatch && 'border-primary bg-primary text-primary-foreground',
            isMiss && 'border-muted-foreground/30',
            isSearching && 'border-primary/40 animate-pulse',
            isError && 'border-destructive text-destructive',
          )}
          aria-hidden="true"
        >
          {isMatch && <Check className="size-3" strokeWidth={3} />}
          {isError && <TriangleAlert className="size-2.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'truncate text-sm leading-snug font-medium transition-colors',
              isMatch ? 'text-foreground' : 'text-muted-foreground',
            )}
            title={story.title}
          >
            {story.title}
          </h3>

          <p className="text-muted-foreground/70 mt-0.5 font-mono text-[11px]">
            {story.file} · {formatBytes(story.bytes)}
          </p>

          {/*
            The matching line, rendered only on a match. `line` outlives a
            status change — the hook keeps it while a new query is in flight —
            so this is gated on `isMatch` rather than on the string existing,
            or a card that has just become a miss would still be quoting.

            Clamped to two rows: the library caps the line at a byte count, and
            a byte count is not a row count in a proportional grid. Without the
            clamp one long line would make its card taller than the rest of its
            row.
          */}
          {isMatch && line !== undefined && (
            <p className="border-primary/30 text-foreground/80 mt-2 line-clamp-2 border-l-2 pl-2 font-mono text-[11px] leading-relaxed break-words">
              {line}
            </p>
          )}
        </div>
      </div>

      <span className="sr-only">
        {isMatch && 'Match found'}
        {isMiss && 'No match'}
        {isSearching && 'Searching'}
        {isError && 'Search failed'}
      </span>
    </Card>
  );
});
