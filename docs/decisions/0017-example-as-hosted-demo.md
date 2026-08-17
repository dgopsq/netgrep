# 0017 — The example becomes the hosted demo, and goes back on the maintenance path

**Status:** Accepted (2026-07-29), amended the same day — [the site moved to a custom
domain](#amendment-the-site-moved-to-netgrepdiegopasqualicom) — and again on 2026-08-16, when
[it moved to `www.netgrep.dev`](#amendment-the-site-moved-to-wwwnetgrepdev), which is where it is now.

## Context

`packages/example` was a webpack 5 app of about 60 lines: a search box, a `searchBatch` call, and a list of
matching urls. Its `package.json` carried an explicit note saying its dependencies were **deliberately**
frozen —

> The example is an unpublished manual smoke test, so its dependencies are not on the maintenance path;
> bumping them buys nothing and risks another dev-server config break.

— and [`AGENTS.md` §6](../../AGENTS.md#6-hard-rules) rule 3 said the same: a demo, not automated, not in CI.

That was a reasonable position for a smoke test nobody could see. It stopped being reasonable once the
project wanted a public demo, because the app had four problems that a reader hits immediately:

**The corpus was mostly duplicates.** 67 files, of which two were the complete Sherlock Holmes canon
(`cano.txt`, `cnus.txt`, 7.1 MB between them), five were omnibus collections and four were novels. Those
eleven files were supersets of the other 56 **and 84% of the bytes**. Almost any query matched most of them,
so the result list carried nearly no information — which is why the page prompted you to type `sherlock`, a
term present in essentially every file.

**Results were unreadable.** The corpus uses four-letter names, so a hit rendered as `✅ /3gab.txt`.

**It hid the one thing worth showing.** `searchBatch` is `Promise.all`, so nothing rendered until the slowest
of 67 downloads finished. Searching *while the file downloads* — [decision 0002](0002-search-while-downloading.md),
the project's defining property — was invisible behind a wait.

**Styling was the Tailwind play CDN**, which is explicitly not for production use.

## Decision

**Rebuild the example as the public demo at `https://dgopsq.github.io/netgrep/`** — now
`https://netgrep.diegopasquali.com/`, see the amendment below — **and accept that its
dependencies are now maintained.** The frozen-dependencies note is deleted; `AGENTS.md` §6 rule 3 is
rewritten rather than quietly left wrong.

| | |
|---|---|
| Stack | Vite 8 + React 19 + TypeScript + Tailwind v4, replacing webpack 5 |
| Components | shadcn/ui foundation (`components.json`, `@/` alias, `cn()`), **Radix-free primitives only** |
| Corpus | the 56 individual stories, 2.6 MB; the 11 canon/collection/novel files deleted |
| Titles | read from each file's own header by `scripts/build-manifest.mjs` into a committed manifest |
| Search | `searchBatchWithCallback`, so each card resolves independently and visibly |
| Cache | **off** — `new Netgrep({ enableMemoryCache: false })`, see below |
| Deploy | `deploy-pages.yml`, gated on the whole of `test-and-lint.yml` |
| CI | `typecheck:example` and `build:example` appended to the existing `bundle` job |

### The memory cache is disabled in the demo

This is the load-bearing correctness decision, and it is not a style preference.

Two P1 defects in [`BACKLOG.md`](../BACKLOG.md) exist **only when the cache is on**, and both produce
confidently wrong answers on a page where people type one query after another:

- **3b, poisoned partial cache.** `search` resolves on the first match, so the entry holds only the prefix
  that happened to be read. A later query for a term further down the same file is answered `false` from
  text that was never downloaded.
- **18, concurrent searches double an entry.** Nothing tracks a download already in flight, and
  `searchBatchWithCallback` starts every search eagerly — so two searches of one url append the file to
  itself with no separator, forming a line that exists nowhere.

Fixing them properly is P1 library work requiring assertion inversions in two suites
([decision 0011](0011-tests-that-assert-known-bugs.md)), and was deliberately **not** bundled into a
redesign. Disabling the cache sidesteps both, costs little — the corpus is 2.6 MB and the browser's own HTTP
cache serves repeats — and does not touch the early-resolution property the page exists to demonstrate.

Defect 3a (chunk-boundary false negatives) is **not** avoidable this way and is live on the page. It is named
in the site's own "Known limitations" section, along with the boolean-only result and the NUL-byte behaviour.

> **Amended 2026-07-30.** 3a and 3b are fixed ([0018](0018-line-oriented-tail-buffer.md)), so the
> chunk-boundary caveat has been removed from the page. The cache is still off, but no longer as a workaround:
> a warm cache would stop the page's timings measuring the network, which is the one thing it exists to show.
> The reasoning in this section is left as written, because it is why the site said what it said.

### Why Vite rather than staying on webpack

shadcn's tooling assumes Vite or Next. Beyond that: the example being on webpack was incidental coverage that
the published package works under webpack, but [backlog 16](../BACKLOG.md) records that the package once broke
**silently under Vite** — returning `false` for every search — which is the more valuable bundler to keep
exercised. What the published package does under other bundlers is established by
[decision 0005](0005-esm-only-distribution.md) and by `verify:pack`, not by this app.

### The site leads with the result; the caveats sit below it

The first version of the page opened with a badge reading "An experiment, not a recommendation" and a
paragraph recommending Pagefind, Lunr and FlexSearch — **three hedges before the reader reached the search
box**, on a page whose job is to show the thing working. That is not what
[`AGENTS.md` §1](../../AGENTS.md#1-what-this-project-is) asks for. It asks that user-facing text describe what
netgrep does and what it costs, and not sell it; it does not ask the demo to argue against itself above the
fold.

So the hero states the capability plainly and the honesty moved down into a **Scope** section, which is still
on the page and still names every live defect. When this was written that included chunk-boundary false
negatives, which affected the demo directly; that one is fixed and its caveat is gone. The costs are still stated: the stats bar reports the corpus size and the 1.15 MB WebAssembly
download on every query. The competitor comparison survives too, repositioned from self-deprecation to
routing: "if you need ranking and snippets, an index is the right tool."

**The README's voice is deliberately still more cautious than the site's**, and that is not drift. Its
audience is a developer deciding whether to depend on the package, who needs the caveat first. The site's
audience is someone finding out what this is, who needs to see it work first. Both are truthful about the
same facts.

## Consequences

**The demo is now a maintained dependency surface.** React, Vite, Tailwind and the shadcn helpers will need
periodic review. [`AGENTS.md` §6](../../AGENTS.md#6-hard-rules) rule 2 still applies — a version change is its
own deliberate task — but "this package is exempt" is no longer true.

**Webpack is no longer exercised anywhere in the repository.** Accepted, with the reasoning above.

**The demo consumes `packages/netgrep/dist/`, not its source.** So `pnpm build` (and therefore `pnpm
build:wasm`) must run before `pnpm dev` or `pnpm build:example` — the old README omitted this and was wrong
about it. It is why `typecheck:example` and `build:example` are separate root scripts placed *after*
`pnpm build` in the `bundle` job rather than folded into `pnpm typecheck`, which runs before it.

**The base path is a real hazard.** The site is served from `/netgrep/`, so a root-relative url silently 404s
and the page looks like a corpus that matches nothing. Exactly one module, `src/lib/story-url.ts`, is allowed
to know this, and `vite dev` deliberately serves from `/netgrep/` too so the mistake fails locally.
(The custom domain has since removed this hazard — see the amendment.)

**Someone must set Settings → Pages → Source to "GitHub Actions" once.** The first deploy fails otherwise, and
no commit can do it.

**Two things stated when this was planned turned out to be wrong**, and are recorded so they are not
rediscovered: shadcn's `separator` wraps `@radix-ui/react-separator` and its `badge` imports
`@radix-ui/react-slot`, so "these six primitives are Radix-free" was false. `separator` was dropped in favour
of a CSS utility, and `badge` was copied in without its `asChild` prop.

## Amendment: the site moved to `netgrep.diegopasquali.com`

**2026-07-29.** The demo is served from **<https://netgrep.diegopasquali.com/>**, a subdomain of the
maintainer's own domain, rather than from the `dgopsq.github.io/netgrep/` project page. Hosting is unchanged —
still GitHub Pages, still `deploy-pages.yml`, still gated on the full test graph. Only the name in front of it
moved.

The motivation is that a project page's URL is not the project's to keep: it is tied to a GitHub account name
and a repository name, and both are things that change. A domain the project controls means the "Try it" link
in the README, and any link anyone else has written down, survives a rename or a move off GitHub entirely.

**The base path went from `/netgrep/` to `/`,** which retires the hazard named in *Consequences* above. A
custom domain serves the site at the root, so `base` in `vite.config.ts` is now `/` and `pnpm dev` runs at
`http://localhost:5173/` rather than under a path prefix. `src/lib/story-url.ts` is **kept** even though
`import.meta.env.BASE_URL` now resolves to `/` and the function composes something a literal string would
match: it is the difference between a future base change being one line and being a search of the codebase,
and the failure it guards against is the silent kind — every fetch 404s and the page reads as a corpus that
matches nothing.

**There is deliberately no `CNAME` file in `packages/example/public/`.** The obvious move — and what nearly
every project-page tutorial says — is to commit one so it lands in the deployed artefact. That advice is for
branch-based publishing. [GitHub's documentation for a custom Actions workflow](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
states that no `CNAME` file is created and "any existing `CNAME` file is ignored and is not required" — so
committing one would be a file that looks load-bearing, is not read by anything, and would silently disagree
with reality the next time the domain changed.

**So the domain lives in two places, neither of them this repository**, and both are manual, in the same way
Settings → Pages → Source was:

- **Settings → Pages → Custom domain** on the repository, set to `netgrep.diegopasquali.com`. This is what
  actually makes Pages answer for the name.
- **A DNS `CNAME` record in Cloudflare**, `netgrep` → `dgopsq.github.io`. Note it points at the *account*
  host, not at `dgopsq.github.io/netgrep` — DNS has no notion of a path, which is precisely why the site
  ends up at the root and the base path had to change.

One operational wrinkle worth recording: GitHub provisions the TLS certificate by resolving the name itself,
so if Cloudflare's proxy (the orange cloud) is on, that check sees Cloudflare rather than Pages and
"Enforce HTTPS" cannot be enabled. Leave the record **DNS-only** until the certificate is issued.

### The page was given a full metadata surface at the same time

A domain of its own is only worth having if the page can be found, so `index.html` gained a canonical link,
an expanded description, Open Graph and Twitter card tags, an icon set and JSON-LD; `public/` gained
`robots.txt` and `sitemap.xml`. Most of that is unremarkable. Three choices are not:

**No `FAQPage` markup**, although the "Scope" section is literally four questions with four answers and every
SEO guide says to mark it up. Google restricted FAQ rich results to authoritative government and health sites
in 2023, so on this domain it yields no rich result — it would be a second copy of the caveat list, carrying
exactly the staleness risk that `limitations.tsx` opens with a warning about. The page has one such list.

**`robots.txt` disallows `/stories/`.** The corpus is 56 public-domain texts serving as demo data. Indexed,
they are 2.6 MB of content available verbatim on Project Gutenberg, competing with the one page on this domain
that is about netgrep. Crawlers are bound by robots.txt; the browser is not, so the demo is unaffected —
Googlebot fetches only what rendering requests, and the page requests nothing until someone types a query.

**The description no longer opens with the disclaimer.** It used to read "An experiment... Not a
recommendation — read the limitations," which in a search result is a line arguing against clicking it. This
is the same split already recorded above: the README's audience needs the caveat first, the site's audience
needs to see it work first, and a search snippet is the site's voice. The caveats did not move — they are
where they were, on the page, above the fold's fold rather than in front of it.

The metadata claims the page **is** what it is: a free web application demonstrating a source-code package.
Two linked entities in the JSON-LD graph rather than one, because the npm library is not a website.

**What none of this does is rank the page.** Metadata makes a page eligible and legible; it does not make it
authoritative, and for a query like "client-side search" the results are dominated by projects with years of
inbound links. The levers that actually move this are getting the domain into Search Console, and being linked
to from places developers read.

### What was trimmed from the shadcn setup, and what was not

shadcn components are vendored, not depended on, so unused parts of them are ordinary dead code. Removed:
`skeleton` (never imported), card's `CardHeader`/`CardTitle`/`CardDescription`/`CardContent` (the one consumer
lays out its own contents), badge's `secondary` and `destructive` variants, the `badgeVariants` export, and
alert's `cva` — the page raises exactly one alert and it is always the destructive one, so there was nothing
to choose between.

**`tw-animate-css` was removed as a dependency.** The only animations on the page are `animate-pulse` and
`animate-spin`, both Tailwind v4 core; that package supplies the `animate-in`/`fade-in` family, which only the
Radix-backed components use, and there are none.

**The CSS token set was deliberately NOT trimmed**, though several names — `--popover`, `--accent`,
`--secondary` — are unused today, as was `@custom-variant dark` and the `class="dark"` on `<html>`. These are
the contract every shadcn component is written against: delete the unused names and the next component copied
in resolves them to nothing and renders unstyled, which is an unpleasant thing to debug. The distinction drawn
is that unused CSS variables cost a few bytes in a file this repository owns, whereas an unused *dependency*
costs install time, lockfile surface and a place on the maintenance path this decision just created.

---

## Amendment: the site deploys on release, not on every push to `main` (2026-07-31)

The `Deploy` row above is out of date. `deploy-pages.yml` no longer triggers on `push: main`; it is called by
`release.yml` when any component releases, and the test gate now sits in the caller rather than inside it.

This record's whole argument is that the site's value is its accuracy, and deploying from `main` quietly
worked against that: the demo ran unreleased code, so its Scope section could describe a library that was not
on npm. Both npm packages sat at `0.1.5` for months while the site showed `main`. It now shows what a visitor
can actually install.

The cost is a lag that did not exist before. A demo-only change ships when it releases, which requires it to
be typed `fix(example):` or `feat(example):` — `docs:` neither releases nor deploys, and a site fix typed that
way waits for some other component to release. Nothing enforces that. See
[0021](0021-release-please.md).

---

## Amendment: there is no cache to disable (2026-08-01)

The `Cache` row in the table above, and the *The memory cache is disabled in the demo* section under it,
both describe a flag that no longer exists. [0024](0024-remove-the-in-memory-cache.md) removed the in-memory
cache from the library, so `new Netgrep()` takes no argument, and 3b and 18 — the two defects that section
says the demo had to steer around — are closed in the library rather than sidestepped in the app.

What survives is the reason that section's own 2026-07-30 amendment fell back on, once the defect argument
had already been overtaken by [0018](0018-line-oriented-tail-buffer.md) and
[0019](0019-in-flight-fetch-registry.md): **the page measures the network.** That is now true by construction
rather than by configuration. Both passages are left as written, because they are why the site said what it
said — and because the property they were protecting is still the one to protect.

---

## Note (2026-08-02) — the corpus this record chose no longer exists

[0026](0026-demo-as-log-dashboard.md) supersedes the **Corpus** row of the table above, and with it the
*Titles* row, the `story-url.ts` sentence under *The base path is a real hazard*, and the `robots.txt`
paragraph. The 56 stories, `stories.ts`, `story-url.ts`, `story-card.tsx` and `build-manifest.mjs` are
deleted; the demo searches four generated log files totalling 408.6 MB, and `robots.txt` now disallows
`/logs/` for the reason the old paragraph gave about `/stories/`. The base-path invariant survives intact —
one module still owns it, and it is now `src/data/logs.ts`.

Everything else here stands and is why the site is what it is: the example is the public demo, its
dependencies are maintained, ~~`searchBatchWithCallback` is still what makes each source resolve visibly on its
own~~ **(2026-08-06: the class and its batch methods are deleted; each source now resolves visibly on its own
because the demo drives one `grep()` per source, which is the same property from a different mechanism.)** The passages above are left as written, because a record that quietly agreed with whatever was done last
would be worth nothing.

---

## Amendment: the site moved to `www.netgrep.dev`

**2026-08-16.** The demo is served from **<https://www.netgrep.dev/>**. Hosting is unchanged again —
GitHub Pages, `deploy-pages.yml`, gated on the full test graph. Only the name in front of it moved, for the
second time.

**This finishes the argument the first amendment started.** That one said a project page's URL is not the
project's to keep, because it is tied to a GitHub account name and a repository name. Moving to
`netgrep.diegopasquali.com` did not remove that dependency so much as relocate it: the demo then lived under
the maintainer's personal domain, and a project that outlives its maintainer's interest in that domain has
the same problem in a new place. `netgrep.dev` is the project's own name, and a link written down against it
survives a rename, a move off GitHub, and a change of maintainer.

**`www` is canonical, not the apex.** This is GitHub's own recommendation for a custom domain and it is
worth the four characters: a `www` host is a single `CNAME` to `dgopsq.github.io`, is served through their
CDN with the DDoS protection that implies, and keeps working if the Pages IP addresses ever change. The apex
`netgrep.dev` carries `A` and `AAAA` records to those addresses **only so that GitHub redirects it to
`www`** — it is not a second canonical origin, and nothing in the repository should name it.

**The base path does not change.** A `www` host serves at the root exactly as the old subdomain did, so
`base` in `vite.config.ts` is still `/` and `src/data/logs.ts` still composes log URLs from
`import.meta.env.BASE_URL`. The hazard retired by the first amendment stays retired.

**There is still deliberately no `CNAME` file** in `packages/example/public/`, for the reason recorded
above: a deployment driven by a workflow ignores it.

**So the domain still lives in two places, neither of them this repository** — but one of them is a
different zone now:

- **Settings → Pages → Custom domain** on the repository, set to `www.netgrep.dev`.
- **DNS in a Cloudflare zone for `netgrep.dev`**, registered at Namecheap with its nameservers pointed at
  Cloudflare. `www` is a `CNAME` to `dgopsq.github.io`; the apex holds the four `A` and four `AAAA` records
  described above.

**`netgrep.diegopasquali.com` now 301s to `https://www.netgrep.dev/`**, path preserved, as a Cloudflare
Redirect Rule in the `diegopasquali.com` zone. Pages answers for one custom domain per repository, so the
old name stopped being served the moment the setting changed; the rule is what keeps every link anyone has
written down working. It requires the old record to be **proxied**, which is the opposite of the rule below
and is safe because the redirect is answered at Cloudflare's edge and never reaches GitHub. Keep it
indefinitely — it costs nothing, and the argument for the move was precisely that written-down links should
survive.

Two operational wrinkles, the first repeated from last time and the second new:

- **Leave the new records DNS-only (grey cloud) until the certificate is issued.** GitHub provisions TLS by
  resolving the name itself, so a proxied record shows it Cloudflare rather than Pages and "Enforce HTTPS"
  cannot be enabled.
- **`.dev` is on the HSTS preload list**, so browsers refuse plain HTTP to it outright. Unlike 2026-07-29
  there is no "serves over HTTP, warns about the certificate" phase: until the certificate exists the site
  is **unreachable rather than insecure**. That is worth recording because it changes what a broken
  migration looks like — and because the instinct it provokes, turning the proxy on to get *something*
  answering, is exactly what prevents the certificate being issued.

## Amendment: the corpus moved to R2 (2026-08-17)

**2026-08-17.** The four searchable log files are served from **<https://logs.netgrep.dev/>**, an R2 bucket
bound to its own subdomain. The *site* is unchanged — still GitHub Pages, still `deploy-pages.yml`, still
`www.netgrep.dev`. What moved is only the corpus, and only because of what it cost to serve it from a Pages
artefact.

**The symptom was seconds of dead air before the first byte.** Measured against the live site, cold:

| source | on the wire (gzip) | TTFB cold (`MISS`) | TTFB warm (`HIT`) |
|---|---|---|---|
| Apache 8.3 MB | 0.6 MB | 0.37 s | — |
| ZooKeeper 40.0 MB | 1.9 MB | 0.86 s | 0.07 s |
| Hadoop YARN 120.1 MB | 9.5 MB | 2.37 s | 0.07 s |
| OpenSSH 240.2 MB | 17.1 MB | **5.49 s** | **0.08 s** |

Two things follow. **On a cache hit it is ~70 ms regardless of size**, so nothing here was ever the engine or
the library — `firstByteMs` in `use-grep-stream.ts` exists because this wait was being read as netgrep being
slow to start. And **GitHub Pages pins `Cache-Control: max-age=600` with no way to change it**, so across
Fastly's POPs a demo with modest traffic serves a cold object to most visitors. The seconds were the common
case, not the tail.

**The wait is not compression.** Requesting `Accept-Encoding: identity` still scales TTFB with size — 6.1 s
uncompressed against 4.3 s gzipped on OpenSSH, both misses. On a miss the edge pulls the whole object from
origin before releasing a byte, so TTFB is the time to move the entire file, and the fix has to be a cache
that stays warm rather than a smaller encoding.

**Cloudflare Pages was considered and cannot host this corpus at all.** The maximum size of a single Pages
asset is **25 MiB**, technical and unraisable, and three of the four files are 40 MB, 120 MB and 240 MB. The
same 25 MiB ceiling applies to Workers static assets. Cloudflare's own guidance for larger files is R2, which
is what this amendment does. R2 allows ~5 TiB per object and Cloudflare's CDN caches objects up to 512 MB on
the free plan, so even the uncompressed 240 MB source is cacheable.

| | |
|---|---|
| Bucket | `netgrep-logs`, bound to `logs.netgrep.dev` |
| Keys | `v<corpusVersion>/<file>` — `v1/openssh.txt` today |
| Bodies | gzipped, ~26 MB for the whole corpus against ~429 MB raw |
| Headers | `Content-Encoding: gzip`, `Content-Type: text/plain; charset=utf-8`, `Cache-Control: public, max-age=31536000, immutable` |
| CORS | `GET`/`HEAD` from `https://www.netgrep.dev`, no credentials |
| Uploaded by | `upload-logs.yml`, `workflow_dispatch` only |

**The objects keep their `.txt` names even though the bodies are gzipped.** `Content-Encoding` is what says so.
A `.gz` key would force the page to know which form it was fetching, and dev — which serves the files
uncompressed — would then need a different URL rather than a different base.

**A year of `immutable` is safe only because the prefix carries a version, and that needs a guard.** The
failure it invites is silent: edit a seed, forget to bump `corpusVersion`, and every edge serves the old
corpus for a year with nothing anywhere reporting an error. `logs.config.json` therefore records a
`corpusHash` over each seed's bytes and target size, and `build-logs.mjs --check` fails when the seeds no
longer match it, naming the bump as the fix. `pnpm logs:hash` refreshes the value after a deliberate change.

**The corpus is no longer generated into `public/`, and that is structural rather than tidiness.** Vite copies
the whole `publicDir` into `dist/`, so a corpus sitting there is ~429 MB of files added to the Pages artefact
that production does not read — it fetches them from R2. Dropping the `prebuild` that generated them is not
enough, because the copy depends on what happens to be on disk: any machine that has run `pnpm dev` would
ship them. `build-logs.mjs` writes to `.logs/` instead, outside `publicDir`, and `plugins/dev-logs.ts` serves
that directory at `/logs/*` in dev. Measured: `dist/` goes from 435 MB to 1.6 MB with the corpus present.

**Dev still reads local files.** `src/data/logs.ts` resolves the base to `.logs/` in dev and to R2 in
production, with `VITE_LOGS_BASE` overriding both — the only way to exercise the real CORS and
`Content-Encoding` path before deploying. A contributor needs neither network nor bucket to run the demo.

**The upload is deliberately outside the release path.** The corpus changes only when a seed, a target size or
`corpusVersion` changes, which is close to never, and every release that ran the upload would need R2
credentials it otherwise has no use for. `upload-logs.yml` is `workflow_dispatch`, and `verify-logs.mjs` reads
the objects back over HTTP afterwards — gzipped, cacheable for a year, readable cross-origin — because a
bucket that uploaded cleanly but has no CORS policy is a demo that fetches nothing, and no build would catch it.
