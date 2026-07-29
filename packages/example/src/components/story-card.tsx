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
}: StoryCardProps) {
  const isMatch = status === 'match';
  const isMiss = status === 'miss';
  const isSearching = status === 'searching';
  const isError = status === 'error';

  return (
    <Card
      className={cn(
        'relative gap-0 overflow-hidden transition-all duration-300',
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
