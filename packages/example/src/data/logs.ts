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
  /**
   * The file's name — under `.logs/` in dev, and the object key within
   * the versioned R2 prefix in production. The same name in both: the object
   * body is gzipped, and `Content-Encoding` is what says so, so there is no
   * `.gz` suffix to account for here.
   */
  file: string;
};

export const sources: LogSource[] = config.sources;

/**
 * Where the corpus is served from, with a trailing slash.
 *
 * THE ONLY PLACE THAT KNOWS WHERE THE FILES LIVE. Production reads them from
 * R2 at `logs.netgrep.dev`, because the four of them come to ~429 MB and
 * Cloudflare Pages caps a single asset at 25 MiB — see
 * `docs/decisions/0017-example-as-hosted-demo.md`. Dev reads what
 * `build-logs.mjs` generated locally, so a contributor needs neither network
 * nor bucket.
 *
 * The prefix carries `corpusVersion` because those objects are served
 * `immutable` for a year. Bumping it is what makes a changed seed reachable;
 * `build-logs.mjs --check` fails the build if a seed moved and the version did
 * not.
 */
function logsBase(): string {
  // Set this to search a bucket from `pnpm dev` — the only way to exercise the
  // real CORS and `Content-Encoding` path before deploying.
  // Destructured, not accessed: a custom `VITE_*` var reaches `ImportMetaEnv`
  // through its index signature, so `env.VITE_LOGS_BASE` trips TypeScript's
  // `noPropertyAccessFromIndexSignature` and `env['VITE_LOGS_BASE']` trips
  // Biome's `useLiteralKeys`. This form satisfies both.
  const { VITE_LOGS_BASE: override } = import.meta.env;
  if (override) return override.endsWith('/') ? override : `${override}/`;

  if (import.meta.env.PROD)
    return `${config.remoteBase}/v${config.corpusVersion}/`;

  return `${import.meta.env.BASE_URL}logs/`;
}

/**
 * Build the URL of a generated log file.
 *
 * Getting this wrong fails quietly: every fetch 404s, every search returns
 * nothing, and the page looks like a corpus that simply matches nothing rather
 * than one it cannot reach. Composing it in one place is what keeps a move of
 * the corpus a one-line edit rather than a hunt.
 */
export function logUrl(source: LogSource): string {
  return `${logsBase()}${source.file}`;
}

/**
 * The URL of the generated size manifest, composed the same way and for the
 * same reason as `logUrl`. Uploaded under the same versioned prefix, so a bump
 * replaces the sizes and the files they describe together.
 *
 * Deliberately fetched rather than imported. `manifest.json` is generated
 * output living in a gitignored directory, so a static import would make
 * `pnpm typecheck:example` fail on a clean clone that has not run the
 * generator — a missing module error about a file nobody committed, on a
 * repository that otherwise typechecks.
 */
export function manifestUrl(): string {
  return `${logsBase()}manifest.json`;
}
