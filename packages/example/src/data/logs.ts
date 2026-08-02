import config from '../../logs.config.json';

/**
 * One generated log source the page searches — read from `logs.config.json`,
 * the same file `scripts/build-logs.mjs` reads to generate the files on disk.
 * One place decides what the page searches.
 */
export type LogSource = {
  /** Stable id, used as a React key and to key per-source state. */
  id: string;
  /** The system that produced the log, shown as the panel's title. */
  service: string;
  /** The seed file under `seeds/` the generator tiles to build this source. */
  seed: string;
  /** The floor `build-logs.mjs` builds this file up to, in bytes. */
  targetBytes: number;
  /** The file's name within `public/logs/`. */
  file: string;
};

export const sources: LogSource[] = config.sources;

/**
 * The combined floor of all four sources, in bytes.
 *
 * Each generated file actually lands slightly at or above its own
 * `targetBytes` — the generator stops at the first whole-seed copy that
 * reaches it, never mid-line — so this is the size the UI can promise a
 * search costs at least, not an exact total.
 */
export const totalBytes: number = sources.reduce(
  (sum, source) => sum + source.targetBytes,
  0,
);

/**
 * Build the URL of a generated log file.
 *
 * THE ONLY PLACE THAT KNOWS ABOUT THE BASE PATH. `import.meta.env.BASE_URL` is
 * whatever Vite's `base` option was set to and always ends in a slash, so it
 * composes by plain concatenation.
 *
 * The site now serves from the root of `https://netgrep.diegopasquali.com`, so
 * that value is `/` and this function currently does nothing a hard-coded
 * `/logs/x.log` would not. It stays anyway: under the old project page at
 * `dgopsq.github.io/netgrep/` the base was `/netgrep/`, and the original example
 * hard-coded root-relative paths in a checked-in list, which fails in a
 * particularly quiet way — every fetch 404s, every search returns `false`, and
 * the page looks like a set of logs that simply matches nothing. One module
 * holding the invariant is what makes a future base change a one-line edit
 * rather than a hunt.
 */
export function logUrl(source: LogSource): string {
  return `${import.meta.env.BASE_URL}logs/${source.file}`;
}
