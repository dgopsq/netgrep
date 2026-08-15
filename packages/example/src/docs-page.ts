import { activeHeadingIndex } from './lib/active-heading';
import './index.css';
import './docs.css';

/**
 * Highlights the table-of-contents entry for the section currently on screen,
 * and opens that section — the seven section titles are always listed, their
 * subsections only while they are being read.
 *
 * Pure progressive enhancement: the page, its navigation and every anchor work
 * with this script absent, which is the reason /docs ships no framework. With
 * it absent the whole list shows, which is long but leaves every link
 * reachable — see the `.is-collapsible` rule in docs.css.
 */
// Paired rather than two parallel arrays, so a link whose target is missing
// is dropped without shifting every later link's index out of sync with its
// heading.
type Entry = { link: HTMLAnchorElement; heading: HTMLElement };

// getAttribute rather than dataset: `noPropertyAccessFromIndexSignature` wants
// `dataset['section']` and Biome's useLiteralKeys wants `dataset.section`, and
// this satisfies both.
function openSection(items: HTMLElement[], current: string | null) {
  for (const item of items) {
    item.classList.toggle(
      'is-open',
      item.getAttribute('data-section') === current,
    );
  }
}

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

  // The <li> is what carries `data-section`, and hiding the row rather than
  // the link is what removes the gap it would otherwise leave behind.
  const items = entries.map(({ link }) => link.closest('li') as HTMLElement);

  document.querySelector('.toc')?.classList.add('is-collapsible');

  const paint = (index: number) => {
    for (const [i, { link }] of entries.entries()) {
      link.classList.toggle('is-current', i === index);
    }

    openSection(items, items[index]?.getAttribute('data-section') ?? null);
  };

  // A clicked link jumps its heading to the top of the viewport, and the
  // jump itself fires `scroll` events — including, for a late heading, ones
  // that land on the bottom-of-document rule and would overwrite the click
  // with the last entry a moment later. Pinning the clicked index and
  // ignoring scroll-driven recomputes while pinned is what keeps the clicked
  // entry active through that self-inflicted scroll. `scroll` therefore
  // cannot be what clears the pin; `wheel`, `touchmove` and `keydown` are,
  // because those only fire for scrolling the reader actually did.
  let pinnedIndex: number | null = null;

  const update = () => {
    if (pinnedIndex !== null) return;
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

  const unpin = () => {
    pinnedIndex = null;
  };
  const unpinAndResize = () => {
    unpin();
    onScroll();
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', unpinAndResize);
  window.addEventListener('hashchange', update);
  window.addEventListener('wheel', unpin, { passive: true });
  window.addEventListener('touchmove', unpin, { passive: true });
  window.addEventListener('keydown', unpin);
  update();

  // The active entry is set immediately on click, rather than waiting on the
  // scroll it triggers, so the highlight responds before the browser even
  // starts moving.
  for (const [i, { link }] of entries.entries()) {
    link.addEventListener('click', () => {
      pinnedIndex = i;
      paint(i);
    });
  }
}
