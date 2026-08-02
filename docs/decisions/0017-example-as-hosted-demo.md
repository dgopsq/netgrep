# 0017 — The example becomes the hosted demo, and goes back on the maintenance path

**Status:** Accepted (2026-07-29), amended the same day — [the site moved to a custom domain](#amendment-the-site-moved-to-netgrepdiegopasqualicom).

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
