# Netgrep demo

The public demo for `@netgrep/netgrep`, live at **<https://netgrep.diegopasquali.com/>**.

Vite + React + Tailwind v4 + shadcn/ui. It is a dashboard over four generated log files — Apache httpd
8.3 MB, ZooKeeper 40.0 MB, Hadoop YARN 120.1 MB and OpenSSH 240.2 MB, 408.6 MB together — and shows each one
resolving individually, as it downloads. See the [main README](https://github.com/dgopsq/netgrep) for what
netgrep is, [decision 0017](../../docs/decisions/0017-example-as-hosted-demo.md) for why this app looks the
way it does, and [decision 0026](../../docs/decisions/0026-demo-as-log-dashboard.md) for why it searches
these files rather than something smaller.

It runs against the **local workspace source**, not a published release, so changes to `packages/netgrep` or
`packages/search` show up here after a rebuild.

## Running it

From the root of the repository:

```bash
pnpm install
pnpm build:wasm   # builds packages/search/pkg/
pnpm build        # builds packages/netgrep/dist/  <- this app imports it
pnpm dev
```

**Both build steps are required**, and the second is easy to miss: this app imports `@netgrep/netgrep`, which
resolves to the workspace package and points at the gitignored `packages/netgrep/dist/`. Without it Vite
fails to resolve the import. `pnpm bootstrap` covers the install and the WASM, but not `pnpm build`.

**`pnpm dev` writes 408.6 MB into `public/logs/` before Vite starts**, in under a second. `predev` and
`prebuild` run `scripts/build-logs.mjs`, which tiles the four committed seeds up to the targets in
`logs.config.json` and skips any file already at size — so it is paid once per checkout, and once per
worktree. The directory is gitignored and must never be committed. To check a built corpus without writing
anything:

```bash
node scripts/build-logs.mjs --check
```

The dev server runs at <http://localhost:5173/> — the same base path as production, deliberately, so a
base-path mistake fails here rather than only after deploying.

## Deployment

`.github/workflows/deploy-pages.yml`, called by `release.yml` when any package releases — so the site shows
what was released rather than what was merged. `release.yml` runs the full `test-and-lint.yml` graph before
anything is tagged, so nothing is deployed from a red build.

It used to deploy on every push to `main`, which meant the demo ran code no consumer could install. A
demo-only change therefore has to be committed as `fix(example):` or `feat(example):` to ship — `docs:`
neither releases nor deploys.

The custom domain lives in **Settings → Pages → Custom domain**, not in this repository: a deploy driven by
a GitHub Actions workflow ignores a `CNAME` file in the artifact, so there is deliberately none in `public/`.
The DNS record itself is a CNAME in Cloudflare pointing at `dgopsq.github.io`.

## Things worth knowing before editing

**The numbers this page shows are network numbers.** Every timing in the `StatsBar` is the cost of actually
fetching a file, and that is the page's only evidence for the claim it makes. netgrep used to keep downloaded
bytes in memory and this app switched that off, precisely so a repeat query could not be timed as a download;
[decision 0024](../../docs/decisions/0024-remove-the-in-memory-cache.md) removed the cache from the library
altogether, so there is no flag to set either way and nothing retained that could be timed instead of a
fetch. **What remains yours to protect is the property, not the flag** — do not add a layer here that answers
a repeat query from memory. What a repeat actually costs is the host's business now, and visible in devtools.
Read the comment in `src/hooks/use-log-search.ts` first; it also explains why overlapping runs still
double-fetch, and why that is accepted.

**Elapsed time is the only thing this page measures, and that is a decision rather than a shortfall.** There
is no progress bar and no bytes-read counter because netgrep reports neither, and no memory figure because a
tab cannot honestly measure one. Do not add a number here to make the page look more instrumented; a
fabricated figure on the one page whose entire value is that it is accurate costs more than the gap does.

**`logs.config.json` is the one place that decides what the page searches.** Both `scripts/build-logs.mjs` and
`src/data/logs.ts` read it, so a source's id, service name, seed, size target and filename are stated once.
`targetBytes` is a **floor**: tiling stops at the first whole seed past it, so every file overshoots. The real
sizes come from the `manifest.json` the generator writes beside the logs, fetched at startup — fetched rather
than imported, because a static import of a gitignored generated file breaks `pnpm typecheck:example` on a
clean clone. A missing manifest is not an error; the page falls back to the targets.

**The corpus is repetitive, and the page's honesty depends on not pretending otherwise.** Each file is one
~512 KB seed concatenated to itself until it passes its target, so every term in it recurs within the first
megabyte. The exceptions are the four `NETGREP-MARKER-<pct>` lines the generator injects at 25%, 50%, 75% and
99% of each file — they are the only genuinely deep needles in 408 MB, and the only honest way to demonstrate
a match that is not near the head. The lines themselves are real output from real systems, which is what keeps
the regex examples on the page real; the volume is manufactured.

**Every suggestion chip matches something, deliberately.** A pattern that matches nothing reads all four
sources to their last byte, and offering that as a one-click chip spends hundreds of megabytes of a visitor's
connection to show a row of dashes. The cost is not hidden by leaving it out — the stats bar states the corpus
total and says in as many words that a query matching nothing reads every byte, and anyone who types one gets
exactly that, honestly timed. Keep both halves.

**The seeds are committed and the attribution is a licence term.** `seeds/*.log` are ~512 KB prefixes of
loghub-2.0 under CC BY 4.0; `seeds/NOTICE.md` carries the citation. The footer line crediting loghub and
linking the licence is not decoration and may not be tidied away. Note `.gitignore` needs its `!/seeds/*.log`
negation — the Vite template's blanket `*.log` would otherwise swallow the seeds themselves.

**The logs are served as `.txt`, and renaming them to `.log` would cost ~380 MB per full-miss query.** GitHub
Pages compresses `text/plain` and serves `.log` as an uncompressed `application/octet-stream`. Measured with
local gzip, the four files compress about 16×, so the corpus is roughly 26 MB on the wire as `.txt` and the
full 408.6 MB as anything Pages will not compress. The extension in `logs.config.json` is load-bearing.

**`src/data/logs.ts` is the only module allowed to know the base path.** It is `/` today, so the indirection
buys nothing visible — but under the old `dgopsq.github.io/netgrep/` project page a root-relative
`/logs/x.txt` silently 404d and the page then looked like a corpus that simply matched nothing. Keep log URLs
going through `logUrl()`.

**The domain is hard-coded in three files, and nothing checks them.** `index.html` (canonical, `og:url`,
`og:image`, and the `@id`s in the JSON-LD), `public/sitemap.xml` and `public/robots.txt` all spell out
`https://netgrep.diegopasquali.com` in full, because canonical and Open Graph URLs must be absolute and Vite's
`base` carries no origin. If the domain moves, grep for it. A stale canonical is the worst of these to get
wrong: it tells Google the real page is somewhere else.

**`public/robots.txt` disallows `/logs/` on purpose.** They are generated demo data, not pages, and indexing
them would put a few hundred MB of synthetic log lines on the domain and bury the one page that is about
netgrep. It does not affect the demo — robots.txt binds crawlers, not the browser, and the page fetches
nothing until someone types a query.

**The icons are generated from `public/favicon.svg`.** After editing it:

```bash
cd packages/example/public
rsvg-convert -w 192 -h 192 favicon.svg -o icon-192.png
rsvg-convert -w 180 -h 180 favicon.svg -o apple-touch-icon.png
```

**`public/og-image.jpg` is cut from `assets/social-preview.png`**, so the unfurl looks like the rest of the
project's artwork — same gradient, same wordmark, same tagline — rather than like a shrunken banner. The
source is 2000×1000 and Open Graph wants 1200×630, which is a slightly wider frame than 2:1, so it is centre
cropped to that ratio first and only then resampled; scaling straight to 1200×630 would stretch the wordmark:

```bash
cp assets/social-preview.png /tmp/og.png
sips -c 1000 1905 /tmp/og.png                                  # centre crop to 1.905:1
sips -z 630 1200 /tmp/og.png                                   # resample
sips -s format jpeg -s formatOptions 88 /tmp/og.png --out packages/example/public/og-image.jpg
```

The previous version was `assets/header.jpg` padded out with pure black, which left the wordmark small in a
letterbox whose black did not match the image's own background. If you replace the image, update
`og:image:alt` in `index.html` too — it describes what is actually in it.

This is a demo, not a test. Correctness is established by `pnpm test`, `pnpm test:rust` and
`pnpm verify:pack`; CI only checks that this app typechecks and builds.
