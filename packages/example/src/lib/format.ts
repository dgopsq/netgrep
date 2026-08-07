/**
 * Format a byte count for display, e.g. `2.6 MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format `part` as a percentage of `whole`, e.g. `8.9%`.
 *
 * One decimal, because the interesting readings are the small ones — an early
 * match on the 8 MB source lands near 9% — and `9%` throws away the digit that
 * says how early. A full read reads `100%` rather than `100.0%`, and so does a
 * read that rounds to it: the difference between 99.96% and all of it is not a
 * difference this page has any business asserting.
 */
export function formatShare(part: number, whole: number): string {
  if (whole <= 0) return '—';

  const share = (part / whole) * 100;

  return share >= 99.95 ? '100%' : `${share.toFixed(1)}%`;
}

/**
 * Format a millisecond duration for display, e.g. `128ms` or `4.2s`.
 *
 * Sub-second precision matters below one second — that is the range the
 * smallest source resolves in — and stops mattering once a search runs long
 * enough to be read in seconds instead.
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;

  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a read rate for display, e.g. `184 MB/s`.
 *
 * ⚠️ END-TO-END, NOT A BENCHMARK OF THE ENGINE. This is bytes delivered to the
 * search divided by wall-clock time, so over the published site it measures
 * GitHub Pages and gzip inflation at least as much as it measures ripgrep. The
 * label beside it has to say so; presented as an engine figure it is a
 * measurement of someone's CDN wearing the library's name.
 *
 * One decimal below 100 MB/s and none above it: the difference between 184 and
 * 184.3 MB/s is run-to-run noise on a network figure, and printing it claims a
 * precision the measurement does not have.
 */
export function formatThroughput(bytes: number, ms: number): string {
  if (bytes <= 0 || ms <= 0) return '—';

  const perSecond = bytes / (1024 * 1024) / (ms / 1000);

  return perSecond >= 100
    ? `${Math.round(perSecond)} MB/s`
    : `${perSecond.toFixed(1)} MB/s`;
}
