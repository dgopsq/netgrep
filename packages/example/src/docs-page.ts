import { activeHeadingIndex } from './lib/active-heading';
import './index.css';
import './docs.css';

/**
 * Highlights the table-of-contents entry for the section currently on screen.
 *
 * Pure progressive enhancement: the page, its navigation and every anchor work
 * with this script absent, which is the reason /docs ships no framework.
 */
// Paired rather than two parallel arrays, so a link whose target is missing
// is dropped without shifting every later link's index out of sync with its
// heading.
type Entry = { link: HTMLAnchorElement; heading: HTMLElement };
const entries: Entry[] = [
  ...document.querySelectorAll<HTMLAnchorElement>('.toc a'),
]
  .map((link) => {
    const heading = document.getElementById(
      decodeURIComponent(link.hash.slice(1)),
    );
    return heading ? { link, heading } : null;
  })
  .filter((entry): entry is Entry => entry !== null);

if (entries.length > 0) {
  // getBoundingClientRect().top is viewport-relative; adding scrollY gives a
  // document-space position. offsetTop is relative to the offset parent
  // instead, which is not what we want here.
  const documentTop = (heading: HTMLElement) =>
    heading.getBoundingClientRect().top + window.scrollY;

  const paint = (index: number) => {
    for (const [i, { link }] of entries.entries()) {
      link.classList.toggle('is-current', i === index);
    }
  };

  const update = () => {
    const tops = entries.map(({ heading }) => documentTop(heading));
    const index = activeHeadingIndex(
      tops,
      window.scrollY,
      window.innerHeight,
      document.documentElement.scrollHeight,
    );
    paint(index);
  };

  // Scroll fires far more often than layout can afford to run on every
  // event; rAF collapses a burst of scroll events into one recompute per
  // frame.
  let scheduled = false;
  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('hashchange', update);
  update();

  // A clicked link jumps its heading straight to the top of the viewport —
  // above where the activation line will settle once the browser finishes
  // scrolling — so the active entry is set immediately rather than waiting
  // on the next scroll event.
  for (const [i, { link }] of entries.entries()) {
    link.addEventListener('click', () => paint(i));
  }
}
