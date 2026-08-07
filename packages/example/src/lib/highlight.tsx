import type { NetgrepMatchRange } from '@netgrep/netgrep';
import type { ReactNode } from 'react';

/**
 * `text` with each match wrapped in `<mark>`.
 *
 * Ranges are UTF-16 offsets into `text` — what `slice` takes — and arrive sorted
 * and non-overlapping, so one forward walk covers the string. Empty `ranges`
 * (every match past the byte cap) renders unmarked, which is honest: the
 * visible text contains no match.
 */
export function highlight(
  text: string,
  ranges: NetgrepMatchRange[],
): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach(({ start, end }) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    if (end > start) {
      // `start` alone is a stable key: ranges are sorted and non-overlapping,
      // so starts are strictly increasing and unique.
      parts.push(
        <mark
          key={start}
          className="bg-primary/20 text-foreground rounded-[2px] px-0.5"
        >
          {text.slice(start, end)}
        </mark>,
      );
    }
    cursor = Math.max(cursor, end);
  });

  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts;
}
