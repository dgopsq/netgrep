/**
 * Format a byte count for display, e.g. `2.6 MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
