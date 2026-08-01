import './index.css';
import './docs.css';

/**
 * Highlights the table-of-contents entry for the section currently on screen.
 *
 * Pure progressive enhancement: the page, its navigation and every anchor work
 * with this script absent, which is the reason /docs ships no framework.
 */
const links = document.querySelectorAll<HTMLAnchorElement>('.toc a');
const headings = [...links]
  .map((link) => document.getElementById(link.hash.slice(1)))
  .filter((heading): heading is HTMLElement => heading !== null);

if (headings.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        for (const link of links) {
          link.classList.toggle(
            'is-current',
            link.hash === `#${entry.target.id}`,
          );
        }
      }
    },
    // A band across the top of the viewport, so the highlighted entry is the
    // heading you are reading under rather than the one entering from below.
    { rootMargin: '-10% 0px -85% 0px' },
  );

  for (const heading of headings) observer.observe(heading);
}
