# 0017 — The example becomes the hosted demo, and goes back on the maintenance path

**Status:** Accepted (2026-07-29).

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

**Rebuild the example as the public demo at `https://dgopsq.github.io/netgrep/`, and accept that its
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
on the page and still names every live defect — including chunk-boundary false negatives, which affect this
very demo. The costs are still stated: the stats bar reports the corpus size and the 1.15 MB WebAssembly
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

**Someone must set Settings → Pages → Source to "GitHub Actions" once.** The first deploy fails otherwise, and
no commit can do it.

**Two things stated when this was planned turned out to be wrong**, and are recorded so they are not
rediscovered: shadcn's `separator` wraps `@radix-ui/react-separator` and its `badge` imports
`@radix-ui/react-slot`, so "these six primitives are Radix-free" was false. `separator` was dropped in favour
of a CSS utility, and `badge` was copied in without its `asChild` prop.

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
