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
  /**
   * The floor `build-logs.mjs` builds this file up to, in bytes.
   *
   * A floor, not a size: tiling stops at the first whole seed copy past this
   * number, so every file overshoots it by up to one seed. It is the fallback
   * the page shows when the generated `manifest.json` — which carries the real
   * figures — cannot be read, and it is never the better answer.
   */
  targetBytes: number;
  /** The file's name within `public/logs/`. */
  file: string;
};

export const sources: LogSource[] = config.sources;

/**
 * Build the URL of a generated log file.
 *
 * THE ONLY PLACE THAT KNOWS ABOUT THE BASE PATH. `import.meta.env.BASE_URL` is
 * whatever Vite's `base` option was set to and always ends in a slash, so it
 * composes by plain concatenation.
 *
 * The site now serves from the root of `https://netgrep.diegopasquali.com`, so
 * that value is `/` and this function currently does nothing a hard-coded
 * `/logs/x.txt` would not. It stays anyway: under the old project page at
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

/**
 * The URL of the generated size manifest, composed the same way and for the
 * same reason as `logUrl`.
 *
 * Deliberately fetched rather than imported. `manifest.json` is generated
 * output living in a gitignored directory, so a static import would make
 * `pnpm typecheck:example` fail on a clean clone that has not run the
 * generator — a missing module error about a file nobody committed, on a
 * repository that otherwise typechecks.
 */
export function manifestUrl(): string {
  return `${import.meta.env.BASE_URL}logs/manifest.json`;
}
