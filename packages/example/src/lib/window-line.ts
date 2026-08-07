import type { NetgrepMatchRange } from '@netgrep/netgrep';

/**
 * Roughly how many characters of a row are visible before it is clipped.
 *
 * ⚠️ A HEURISTIC, NOT A MEASUREMENT, and the one soft number in this module.
 * A row is 12px monospace — about 7.2px a character — in a container that is
 * ~1060px wide at the page's `max-w-6xl`, so ~145 characters fit on a desktop
 * viewport and fewer on anything narrower.
 *
 * 120 deliberately sits under that. The two ways to be wrong are not equal:
 * windowing a line that would have fit costs an ellipsis nobody needed, while
 * failing to window one that did not costs the highlight entirely, which is the
 * bug this module exists for. So it errs low.
 *
 * Measuring the container and deriving this per render is the honest fix, and
 * it means threading a width from `ResultFeed` through every row. Worth doing
 * if the ellipsis starts showing up on lines that plainly had room.
 */
export const VISIBLE_CHARS = 120;

/**
 * How much of the line's head survives windowing.
 *
 * A log line begins with its timestamp and level, which is the context you need
 * to place the match at all — `2016-09-28 04:30:31 INFO ` is 25 characters, so
 * this keeps that and a little more. Showing the match by throwing this away
 * would trade one missing piece of context for another.
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
 * A view of `line` that is guaranteed to contain its first match.
 *
 * THE PROBLEM THIS SOLVES IS A ROW THAT LOOKS LIKE A FALSE POSITIVE. Rows are
 * one clipped line of monospace, so a match at column 300 was simply not
 * rendered — the visitor saw a line with no highlight in it and no reason to
 * believe the search had worked. On tiled logs whose lines run past 200
 * characters that is not an edge case.
 *
 * The shape returned is `head … context[match]rest`: enough of the beginning to
 * place the line in time, a visible gap, then the match with a little of what
 * came before it. Fixed-height rows are preserved, which is what keeps the
 * virtualizer simple and the feed scannable.
 *
 * ⚠️ RANGES COME BACK REBASED ONTO `text` AND THE TWO MUST BE USED TOGETHER.
 * Handing these ranges to the original line, or the original ranges to this
 * text, marks the wrong characters — which is worse than not highlighting at
 * all, because it is wrong rather than absent.
 *
 * Only the FIRST match is guaranteed visible. Later ones may still fall off the
 * right edge, and that is accepted: a row is one line, and the question it has
 * to answer is "why is this here", which the first match answers.
 */
export function windowLine(
  line: string,
  ranges: NetgrepMatchRange[],
  visibleChars: number = VISIBLE_CHARS,
): WindowedLine {
  const first = ranges[0];

  // Nothing to centre on. `ranges` is empty when every match sat past the
  // library's byte cap, and then the visible text genuinely contains no match.
  if (first === undefined) return { text: line, ranges, elided: false };

  // Already on screen — including every line short enough to fit whole.
  if (first.start < visibleChars) return { text: line, ranges, elided: false };

  // Never walk backwards into the head: `start` is past `visibleChars`, which
  // is far beyond `HEAD_CHARS + LEAD_CHARS`, so this only guards the constants
  // being retuned into overlapping each other.
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
