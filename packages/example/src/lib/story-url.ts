/**
 * Build the URL of a story file.
 *
 * THE ONLY PLACE THAT KNOWS ABOUT THE BASE PATH. `import.meta.env.BASE_URL` is
 * whatever Vite's `base` option was set to and always ends in a slash, so it
 * composes by plain concatenation.
 *
 * The site now serves from the root of `https://netgrep.diegopasquali.com`, so
 * that value is `/` and this function currently does nothing a hard-coded
 * `/stories/x.txt` would not. It stays anyway: under the old project page at
 * `dgopsq.github.io/netgrep/` the base was `/netgrep/`, and the original example
 * hard-coded root-relative paths in a checked-in list, which fails in a
 * particularly quiet way — every fetch 404s, every search returns `false`, and
 * the page looks like a corpus that simply matches nothing. One module holding
 * the invariant is what makes a future base change a one-line edit rather than
 * a hunt.
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
