import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Only the surface. shadcn's card ships CardHeader/Title/Description/Content/
 * Footer alongside this; `story-card.tsx` is the one consumer and lays out its
 * own contents, so those were dead code rather than a component library.
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-card text-card-foreground flex flex-col rounded-xl border',
        className,
      )}
      {...props}
    />
  );
}

export { Card };
