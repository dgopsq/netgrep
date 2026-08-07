# Netgrep demo

The public demo for `@netgrep/netgrep`, live at **<https://netgrep.diegopasquali.com/>**.

Vite + React + Tailwind v4 + shadcn/ui. It greps **one** generated log file at a time — Apache httpd 8.3 MB,
ZooKeeper 40.0 MB, Hadoop YARN 120.1 MB or OpenSSH 240.2 MB — and streams every matching line into a
virtualized feed as the file downloads. See the [main README](https://github.com/dgopsq/netgrep) for what
netgrep is, [decision 0017](../../docs/decisions/0017-example-as-hosted-demo.md) for why this app looks the
way it does, [decision 0026](../../docs/decisions/0026-demo-as-log-dashboard.md) for why it searches these
files rather than something smaller, and
[decision 0028](../../docs/decisions/0028-demo-as-live-grep.md) for why it enumerates rather than answering a
yes/no question over all four at once.

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
worktree. The directory is gitignored and must never be committed. To check the built logs without writing
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

**The numbers this page shows are network numbers.** Every timing in the run figures is the cost of actually
fetching a file, and that is the page's only evidence for the claim it makes. netgrep used to keep downloaded
bytes in memory and this app switched that off, precisely so a repeat query could not be timed as a download;
[decision 0024](../../docs/decisions/0024-remove-the-in-memory-cache.md) removed the cache from the library
altogether, so there is no flag to set either way and nothing retained that could be timed instead of a
fetch. **What remains yours to protect is the property, not the flag** — do not add a layer here that answers
a repeat query from memory. What a repeat actually costs is the host's business now, and visible in devtools.
Read the comment in `src/hooks/use-grep-stream.ts` first.

**Every number on this page is measured, and the one it refuses is refused because it cannot be.** Elapsed
time comes from the search; bytes read come from `GrepOptions.onProgress`, which reports cumulative
decompressed bytes after each network chunk. That figure used to be reverse-engineered by a `window.fetch`
wrapper this app owned, deleted once the library reported it directly — and the finding that the browser's
Resource Timing entries report zero for an aborted transfer is **retained history rather than current
mechanism**, kept so nobody re-probes it.

**There is now a progress bar, and the rule that refused one is unchanged.** It was refused on two grounds:
netgrep exposed no progress, and `Content-Length` on a gzipped response is the compressed size, so there was
no honest total to divide by. `onProgress` supplies the numerator and the generated `manifest.json` the real
uncompressed size as the denominator, so the bar divides one measured number by another. What was refused was
*an animation impersonating a measurement*, and that is still refused — which is why there is still **no
memory figure**, because a tab cannot honestly measure one. Do not add a number here to make the page look
more instrumented; a fabricated figure on the one page whose entire value is that it is accurate costs more
than the gap does.

⚠️ **The bytes-read figure is decompressed file content, not bandwidth.** The logs are served gzipped and
compress about 16×, so a full read reading `240.2 MB` was carried by roughly 15 MB on the wire. It is labelled
**Scanned** precisely because that word cannot be mistaken for a transfer figure, and the sentence under the
run figures that spells the difference out is a term of the measurement rather than a caption. Do not shorten
it to the point where it stops distinguishing the two.

**`logs.config.json` is the one place that decides what the page searches.** Both `scripts/build-logs.mjs` and
`src/data/logs.ts` read it, so a source's id, service name, seed, size target and filename are stated once.
`targetBytes` is a **floor**: tiling stops at the first whole seed past it, so every file overshoots. The real
sizes come from the `manifest.json` the generator writes beside the logs, fetched at startup — fetched rather
than imported, because a static import of a gitignored generated file breaks `pnpm typecheck:example` on a
clean clone. A missing manifest is not an error; the page falls back to the targets.

**The log files are repetitive, and the page's honesty depends on not pretending otherwise.** Each file is one
~512 KB seed concatenated to itself until it passes its target, so every term in it recurs within the first
megabyte. **That tiling is also what fills the feed**: a common term does not match once but tens of thousands
of times, which is the workload the 100,000-line retention ceiling in `src/lib/hit-buffer.ts` exists for. The
exceptions are the four `NETGREP-MARKER-<pct>` lines the generator injects at 25%, 50%, 75% and
99% of each file — they are the only genuinely deep needles in 408 MB, and the only honest way to demonstrate
a match that is not near the head. The lines themselves are real output from real systems, which is what keeps
the regex examples on the page real; the volume is manufactured.

**The "every suggestion chip matches something" rule is retired, and its premise is why.** It existed because
a zero-match query read all four sources to their last byte, so offering one as a one-click chip spent
hundreds of megabytes of a visitor's connection to show a row of dashes. Under enumeration there is no early
exit for it to be expensive relative to: `grep()` yields every matching line, and the last one cannot be known
before the last byte, so a query matching nothing costs exactly what a query matching everything costs. The
`zzz-no-such-line` chip is now the cheapest honest way to show what a full read costs — the other half of the
page's argument. See [decision 0028](../../docs/decisions/0028-demo-as-live-grep.md).

**The seeds are committed and the attribution is a licence term.** `seeds/*.log` are ~512 KB prefixes of
loghub-2.0 under CC BY 4.0; `seeds/NOTICE.md` carries the citation. The footer line crediting loghub and
linking the licence is not decoration and may not be tidied away. Note `.gitignore` needs its `!/seeds/*.log`
negation — the Vite template's blanket `*.log` would otherwise swallow the seeds themselves.

**The logs are served as `.txt`, and renaming them to `.log` would cost ~380 MB per full-miss query.** GitHub
Pages compresses `text/plain` and serves `.log` as an uncompressed `application/octet-stream`. Measured with
local gzip, the four files compress about 16×, so they are roughly 26 MB on the wire as `.txt` and the
full 408.6 MB as anything Pages will not compress. The extension in `logs.config.json` is load-bearing.

**`src/data/logs.ts` is the only module allowed to know the base path.** It is `/` today, so the indirection
buys nothing visible — but under the old `dgopsq.github.io/netgrep/` project page a root-relative
`/logs/x.txt` silently 404d and the page then looked like a set of files that simply matched nothing. Keep
log URLs going through `logUrl()`.

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
