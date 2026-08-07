import type { NetgrepMatchRange } from '@netgrep/netgrep';

/**
 * Roughly how many characters of a row are visible before it is clipped.
 *
 * ⚠️ A HEURISTIC, NOT A MEASUREMENT. ~145 fit at desktop width and fewer when
 * narrower; 120 sits under that deliberately, because windowing a line that
 * would have fit costs a needless ellipsis while missing one costs the
 * highlight entirely. Measuring the container and passing the width in is the
 * honest fix, worth doing if ellipses appear on lines that plainly had room.
 */
export const VISIBLE_CHARS = 120;

/**
 * How much of the line's head survives windowing. `2016-09-28 04:30:31 INFO `
 * is 25 characters, and that timestamp and level is the context needed to place
 * the match at all.
 */
export const HEAD_CHARS = 28;

/** Characters of the line kept immediately before the match, for context. */
const LEAD_CHARS = 12;

/** What stands in for the elided middle. Spaced, so it reads as a gap. */
const GAP = ' … ';

export type WindowedLine = {
  /** The text to render. */
  text: string;
  /** Match positions within `text` — NOT within the original line. */
  ranges: NetgrepMatchRange[];
  /** Whether a middle section was dropped, i.e. whether `text` contains a gap. */
  elided: boolean;
};

/**
 * A view of `line` guaranteed to contain its first match, shaped
 * `head … context[match]rest`.
 *
 * Rows are one clipped line, so a match at column 300 was never rendered and
 * the row read as a false positive. Windowing keeps the fixed row height that
 * the virtualizer and the feed's scannability depend on.
 *
 * ⚠️ RANGES COME BACK REBASED ONTO `text`; USE THE TWO TOGETHER. Crossing them
 * marks the wrong characters, which is worse than no highlight at all.
 *
 * Only the first match is guaranteed visible. A row is one line, and the
 * question it answers is "why is this here".
 */
export function windowLine(
  line: string,
  ranges: NetgrepMatchRange[],
  visibleChars: number = VISIBLE_CHARS,
): WindowedLine {
  const first = ranges[0];

  // Nothing to centre on: `ranges` is empty when every match sat past the
  // library's byte cap, so the visible text genuinely contains no match.
  if (first === undefined) return { text: line, ranges, elided: false };

  // Already on screen — including every line short enough to fit whole.
  if (first.start < visibleChars) return { text: line, ranges, elided: false };

  // Guards the constants being retuned until head and window overlap.
  const from = Math.max(first.start - LEAD_CHARS, HEAD_CHARS);
  const shift = HEAD_CHARS + GAP.length - from;

  return {
    text: line.slice(0, HEAD_CHARS) + GAP + line.slice(from),
    ranges: ranges.map((range) => ({
      start: range.start + shift,
      end: range.end + shift,
    })),
    elided: true,
  };
}
