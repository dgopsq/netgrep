/** How far down the viewport the activation line sits, as a fraction of its height. */
const ACTIVATION_FRACTION = 0.1;

// Real browsers routinely report scrollY + innerHeight a fraction of a pixel
// short of scrollHeight at a full scroll — fractional device pixel ratios,
// zoom, subpixel layout — so an exact >= comparison misses a genuinely
// bottomed-out page and reintroduces the "last headings never highlight" bug.
const BOTTOM_TOLERANCE_PX = 2;

/**
 * Which table-of-contents heading is "active" for the current scroll position.
 *
 * The active heading is the last one whose top has crossed an activation line
 * near the top of the viewport — reading position, not intersection with a
 * band, so a heading scrolled to the very top (as a clicked link does) still
 * counts. Two special cases override that: before the first heading, the
 * first entry is active; and once the page is scrolled to its bottom, the
 * last entry is active regardless, because the remaining headings may never
 * be able to reach the activation line before the document runs out of
 * scroll.
 *
 * @param tops document-space y of each heading's top, ascending
 * @param scrollY current vertical scroll offset
 * @param viewportHeight height of the visible viewport
 * @param documentHeight total scrollable height of the document
 * @returns index into `tops` of the active heading, or -1 when `tops` is empty
 */
export function activeHeadingIndex(
  tops: number[],
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
): number {
  if (tops.length === 0) return -1;

  // A document no taller than the viewport cannot be scrolled, so it must
  // never satisfy "scrolled to the bottom" even though scrollY + viewportHeight
  // trivially reaches documentHeight — there is no scroll position to be at.
  const canScroll = documentHeight > viewportHeight;
  if (
    canScroll &&
    scrollY + viewportHeight >= documentHeight - BOTTOM_TOLERANCE_PX
  ) {
    return tops.length - 1;
  }

  const activationLine = scrollY + viewportHeight * ACTIVATION_FRACTION;

  let index = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= activationLine) index = i;
    else break;
  }
  return index;
}
