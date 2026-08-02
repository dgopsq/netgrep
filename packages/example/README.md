# Netgrep demo

The public demo for `@netgrep/netgrep`, live at **<https://netgrep.diegopasquali.com/>**.

Vite + React + Tailwind v4 + shadcn/ui. It searches 56 Sherlock Holmes short stories (2.6 MB) and shows each
file resolving individually, as it downloads. See the [main README](https://github.com/dgopsq/netgrep) for
what netgrep is, and [decision 0017](../../docs/decisions/0017-example-as-hosted-demo.md) for why this app
looks the way it does.

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
Read the comment in `src/hooks/use-corpus-search.ts` first; it also explains why overlapping runs still
double-fetch, and why that is accepted.

**`src/lib/story-url.ts` is the only module allowed to know the base path.** It is `/` today, so the
indirection buys nothing visible — but under the old `dgopsq.github.io/netgrep/` project page a root-relative
`/stories/x.txt` silently 404d and the page then looked like a corpus that simply matched nothing. Keep story
URLs going through it.

**The domain is hard-coded in three files, and nothing checks them.** `index.html` (canonical, `og:url`,
`og:image`, and the `@id`s in the JSON-LD), `public/sitemap.xml` and `public/robots.txt` all spell out
`https://netgrep.diegopasquali.com` in full, because canonical and Open Graph URLs must be absolute and Vite's
`base` carries no origin. If the domain moves, grep for it. A stale canonical is the worst of these to get
wrong: it tells Google the real page is somewhere else.

**`public/robots.txt` disallows `/stories/` on purpose.** They are 56 public-domain texts used as demo data,
not pages, and indexing them would put 2.6 MB of duplicate content on the domain. It does not affect the demo
— robots.txt binds crawlers, not the browser.

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

**`src/data/stories.ts` is generated.** Titles are read out of each file's own header block. After adding or
removing a file in `public/stories/`:

```bash
pnpm --filter @netgrep/example manifest
```

**The corpus is deliberately only the individual stories.** The complete-canon dumps, the omnibus collections
and the novels were removed: they were supersets of the 56 remaining files and 84% of the bytes, so nearly
every query matched all of them and the result list said nothing.

This is a demo, not a test. Correctness is established by `pnpm test`, `pnpm test:rust` and
`pnpm verify:pack`; CI only checks that this app typechecks and builds.
