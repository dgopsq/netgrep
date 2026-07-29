/**
 * Build the URL of a story file.
 *
 * THE ONLY PLACE THAT KNOWS ABOUT THE BASE PATH. The site is served from
 * `https://dgopsq.github.io/netgrep/`, so a story is at `/netgrep/stories/x.txt`
 * and not at `/stories/x.txt`. `import.meta.env.BASE_URL` is whatever Vite's
 * `base` option was set to and always ends in a slash, so it composes by plain
 * concatenation.
 *
 * The original example hard-coded root-relative paths (`/3gab.txt`) in a
 * checked-in list. That works under a dev server at the domain root and breaks
 * silently on project pages — every fetch 404s, every search returns `false`,
 * and the page looks like a corpus that simply matches nothing.
 */
export function storyUrl(file: string): string {
  return `${import.meta.env.BASE_URL}stories/${file}`;
}

/**
 * Format a byte count for display, e.g. `2.6 MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
