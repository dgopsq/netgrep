# AGENTS.md

Operating guide for AI agents working in the **netgrep** repository.
Canonical source — `CLAUDE.md` points here. Keep this file authoritative; do not fork its content.

Everything below was verified end-to-end on **2026-07-30** (macOS arm64, Node 24.18.0, Rust 1.97.1).

---

## 1. What this project is

netgrep is a port of [ripgrep](https://github.com/BurntSushi/ripgrep) to WebAssembly that searches remote
files **over HTTP while they are still downloading**. It answers exactly one question: *does this pattern
occur in the file at this URL?* — a boolean, plus, if the caller asks for it, the first matching line
([decision 0020](docs/decisions/0020-the-matching-line.md)) and each match's position within that line
([decision 0022](docs/decisions/0022-capture-ranges.md)). Nothing more: no line numbers, no file offsets, no
match counts, no ranking.

The case it is built for is being handed a URL with no shell on the machine that holds the file: an
artefact on a CI platform, a published corpus, a log a support agent can open but not download. The
file still has to be one an anonymous cross-origin request can fetch — netgrep sends no headers and
no cookies, so anything behind a login is out of reach until item **22** lands. It also works for a
small static corpus you own — a blog's raw post files, searched with nothing new deployed — but that
is an example, not the definition.

**Positioning is deliberate and is documented in [decision 0025](docs/decisions/0025-streaming-grep-over-http.md).**
Describe what netgrep does and what it costs. The WebAssembly download is stated wherever the project
is introduced; where a prebuilt index beats netgrep is stated plainly on the limitations page and in
the guide, once. Neither belongs above the fold, and neither may be quietly dropped — the test for any
sentence is whether a developer who reads it, installs the package, and hits the limit an hour later
would feel informed or misled.

**Project status: maintained, conservative.** The toolchain is current and CI is green. Keep it that way: fix
defects, keep dependencies from rotting, keep it working for existing consumers. That is still the bulk of the
work, and [`docs/BACKLOG.md`](docs/BACKLOG.md) is where it is listed.

**A feature needs an issue and a decision record before it needs a diff.** This rule used to read "do not add
features", full stop. It was changed when [0020](docs/decisions/0020-the-matching-line.md) shipped the first
widening of the API, because a project cannot ship a feature under a document forbidding them — but the
friction is the point and it is kept. So:

- **Open an issue and argue it there first.** The proposal that became 0020 was
  [#19](https://github.com/dgopsq/netgrep/issues/19), and the argument in it changed the design twice before
  any code was written. Do not skip to a pull request.
- **The record ships with the change**, in the same PR — including a *Rejected alongside* section naming what
  the feature does **not** open the door to. Every widening makes the next ask more reasonable; writing the
  refusals down at the moment of acceptance is the only brake this repository has.
- **The API is still deliberately small.** A boolean per URL, plus, on request, the matching line and each
  match's position within it. Line numbers, file-absolute byte offsets, match counts, all-matches, context
  lines and ranking have each been considered and refused — see
  [0022](docs/decisions/0022-capture-ranges.md)'s table, which carries 0020's forward, before re-opening any
  of them. Node support is untouched by this and remains a design conversation.
- **If it changes what a result contains or costs, §2.3 applies**: the published demo has to agree with it.

---

## 2. ⚠️ Read this before you edit anything

Three things will mislead you if you do not know them.

### 2.1 Some tests assert behaviour that is WRONG, on purpose

`packages/netgrep/src/lib/Netgrep.integration.spec.ts` ends with a block titled
**`documented defects (asserting current, incorrect behaviour)`**. Those assertions pin known bugs — a NUL byte
discarding a block of lines, a match longer than the 64 KB tail ceiling still spanning a chunk boundary, and so
on. `packages/search/tests/search.rs` has a `documented_defects` module doing the same for the ones that live in
the engine, where a failure names `lib.rs` without a browser and a stream in the way.

They are not mistakes and they are not out of date. Their job is to detect *unintended* change during
dependency work: a test asserting the correct-but-unimplemented behaviour would fail today and tell us
nothing.

**Several assertions in that block are labelled `(FIXED)` and assert CORRECT behaviour.** They stay, inverted
in place, with a note saying what they used to claim — that is what the rule below requires, and it is how the
block records its own history. Do not tidy them out into the suites above.

**If one of them fails, that is a signal, not a nuisance.** Something changed the engine's behaviour. Find out
what, decide whether the new behaviour is right, and if it is, **invert the assertion in the same PR** with a
note saying why. Do not "fix" a defect test to make CI green, and do not fix the underlying bug without
inverting its test in the same change.

**An entry stays while the behaviour it names could still change silently — inverted in place once fixed. It
leaves only when there is no defect left to track: the subject was deleted, so there is nothing to assert; or
the behaviour is now deliberate, and its assertion belongs in the ordinary suite as a design boundary.**
Removing the in-memory cache took the `BACKLOG 3b` and `BACKLOG 18` entries out on one of those grounds each —
3b pinned a cache entry answering a later query, and there is no entry, while 18's double fetch came back and
is now intended, so its assertion moved into the ordinary suite beside the boundary it describes. That is not
the tidying this section forbids: the entries left because the code they described did, and
[decision 0024](docs/decisions/0024-remove-the-in-memory-cache.md) argues each one.

This has already paid for itself once: upgrading off the ripgrep fork silently fixed the `^`-anchoring bug,
and only this block noticed.

### 2.2 The WASM must be built before almost anything works

`@netgrep/netgrep` resolves `@netgrep/search` to this workspace, and that package's entry points at
`packages/search/pkg/` — a **gitignored build output**. On a fresh clone it does not exist, so `pnpm
typecheck`, `pnpm build` and the integration tests all fail until you run:

```bash
pnpm build:wasm
```

`pnpm install` works without it, and so do the unit tests (they mock the engine). Everything else does not.
This is the first thing to try when something fails inexplicably on a clean checkout.

`pnpm bootstrap` does this step for you, along with the install and Playwright's Chromium — see §4.1.

### 2.3 ⚠️ Fixing a defect is not finished until the DEMO SITE stops warning about it

The example is a **published two-page site** — <https://netgrep.diegopasquali.com/> — and its `/docs` page
tells visitors what netgrep cannot do. A fix that leaves that list alone puts the project in the worst possible
position: a live site confidently warning the world about a bug that no longer exists. The site's only value
is that it is accurate, so stale honesty is worse than none.

**So a change to library behaviour is incomplete until the site agrees with it.** This is the same rule as
§2.1 and it fires on the same commits: fixing a defect means inverting its test *and* updating the site, both
in the PR that fixes it.

**Nothing enforces this.** No test fails, CI stays green, and the site keeps lying until a human notices. That
is exactly why it is in this section rather than in a comment somewhere.

**This is now enforced, for the caveat list.** Every limitation lives once, in
[`docs/guide/caveats.data.json`](docs/guide/caveats.data.json). `pnpm docs:sync` renders it onto the
guide's Limitations page and the README's defect list, and CI runs `pnpm docs:sync --check` — so the two
cannot disagree. Fixing a defect means **deleting one entry from that file** and running `pnpm docs:sync`,
in the PR that fixes it.

**The demo page does not restate any of this — it links to it.** Its "Scope" section was removed once `/docs`
existed to carry the same list generated; one line in the demo's footer now points at the guide's
limitations. A visitor has to follow that link where the list used to be in front of them, and in exchange
what they land on cannot go stale.

One thing the generator does not decide, and you must:

| Field | What it means |
|---|---|
| `kind` | `defect` (a bug, listed in the README and under the guide's *Defects* heading) or `by-design` (never fixed — in the guide under *By design*, kept out of the README's defect list, where it would be a bug report for a decision) |

`backlog` is carried and never rendered. It records which item pins the defect, for a maintainer reading the
data file; published documentation does not send a reader to an internal tracker. Do not delete it as unused.

**Adding a defect is still a judgement call, and `--check` cannot make it for you.** CI verifies that
the two generated surfaces agree with `caveats.data.json`. Nothing detects a defect that was never
entered into it in the first place. So when you add one to [`docs/BACKLOG.md`](docs/BACKLOG.md),
decide whether a visitor is affected: if so, add an entry here; if not, no action — but make it a
decision, not an omission.

**Still not enforced, and still yours to check:** the `StatsBar` line, which states the 1.17 MB
WebAssembly download and has to move when the binary does; and the hero copy, which no longer states the
scope of a result — since [decision 0025](docs/decisions/0025-streaming-grep-over-http.md) its accent
claims **constant memory**. The second is the harder one, because the page demonstrates nothing about
memory: the claim holds only while the library retains nothing, so anything that reintroduces retention
makes the hero wrong with no test failing. **Do not add a number to the page to make it look measured.**

> [!WARNING]
> **The page measures the network, and that is now true by construction.** This section spent two revisions on
> the demo's cache flag: first that fixing 3b and 18 would mean switching the cache back on, then that it had
> to stay off regardless because a warm `Record` lookup timed as a download makes the `StatsBar` lie. Neither
> instruction survives — [decision 0024](docs/decisions/0024-remove-the-in-memory-cache.md) deleted the cache,
> so there is no flag to set either way and nothing the library retains that could be timed instead of a
> fetch. What survives is the property those revisions were protecting: **the demo's numbers are network
> numbers, and anything that would answer a repeat query from memory breaks them.** The browser's own HTTP
> cache is the one thing that still can, and it is not the library's to switch off — GitHub Pages serves the
> corpus with `cache-control: max-age=600` (measured 2026-08-01), so what a repeat costs is the host's answer
> rather than netgrep's. Read the comment in `packages/example/src/hooks/use-log-search.ts` before changing
> anything about it. See also
> [decision 0018](docs/decisions/0018-line-oriented-tail-buffer.md) and
> [decision 0019](docs/decisions/0019-in-flight-fetch-registry.md), which record the shape this used to have.

**Do not delete a caveat to tidy the guide or the README.** The list is short because the defects are few, not
because a page is being edited for length — and it is the only reason a visitor has to trust the rest of it.

---

## 3. Toolchain

Versions are pinned in files, and CI reads those files rather than restating them. Change a version in one
place only.

| Tool | Version | Pinned in |
|---|---|---|
| Node | **24.18.0** | `.node-version` |
| pnpm | **11.17.0** | `packageManager` in root `package.json` (via corepack) |
| Rust | **1.97.1** | `rust-toolchain.toml`, with `wasm32-unknown-unknown` + clippy |
| wasm-pack | 0.13.1 | CI action; install locally with `cargo install wasm-pack` |
| Playwright | 1.62.0 | root `package.json` + lockfile; the browser it downloads is pinned to it — see §4.2 |

The Rust pin is deliberate, not incidental. `rust-toolchain.toml` used to say `channel = "stable"`, which
meant an unrelated Rust release broke the build with no commit to point at (1.82 changed the wasm C ABI).
Moving the pin is a reviewable commit; drifting is not.

**CI builds on one Node version, not a matrix.** A Node 20/22/24 matrix was considered and rejected: the
shipped artefact is a browser-targeted ESM library, so the Node version only ever affects build tooling.

---

## 4. Commands

All run from the repository root.

```bash
pnpm bootstrap         # fresh clone or fresh worktree: does both of the below
```
```bash
pnpm install           # once
pnpm build:wasm        # REQUIRED FIRST — see §2.2
```

| Task | Command | Notes |
|---|---|---|
| Prepare a checkout | `pnpm bootstrap` | Install + WASM + browser. Idempotent — see §4.1 |
| New worktree | `pnpm worktree <branch>` | `git worktree add` beside this checkout, then bootstrap it |
| Build WASM | `pnpm build:wasm` | → `packages/search/pkg/`, ~1.17 MB `index_bg.wasm` |
| Build TS | `pnpm build` | → `packages/netgrep/dist/` |
| Lint | `pnpm lint` | Biome (JS/TS) **and** clippy (`-D warnings`); `lint:js` / `lint:rust` run one each |
| Format | `pnpm format` | Biome, writes in place |
| Typecheck | `pnpm typecheck` | `tsc --noEmit`, TypeScript 7 |
| Test TS | `pnpm test` | Vitest — **178 tests**: 60 unit in Node, 47 integration in headless Chromium, 71 tooling in Node |
| — one suite | `pnpm test:unit` / `pnpm test:browser` / `pnpm test:tools` | The three Vitest projects separately. Only `test:browser` needs WASM or a browser |
| Test the tooling | `pnpm test:tools` | **71 tests** over the docs generator, the guide renderer and the example's pure modules. Touches neither the library nor `pkg/` |
| Test Rust | `pnpm test:rust` | `cargo test`, native, no browser — **57 tests** |
| Regenerate the caveat surfaces | `pnpm docs:sync` | Renders `docs/guide/caveats.data.json` onto the guide and the README. `--check` writes nothing and exits 1 when they disagree — §2.3 |
| Verify packaging | `pnpm verify:pack` | Packs both packages and inspects the tarballs. **Needs `pnpm build` first** |
| Run the demo | `pnpm dev` | Vite, at <http://localhost:5173/>. **Needs `pnpm build` first** — see below |
| Typecheck the demo | `pnpm typecheck:example` | Separate from `pnpm typecheck`; **needs `pnpm build` first** |
| Build the demo | `pnpm build:example` | → `packages/example/dist/`. **Needs `pnpm build` first** |
| Generate the demo corpus | `pnpm --filter @netgrep/example logs` | Tiles `seeds/` into `public/logs/` — 408.6 MB, gitignored, ~0.8 s. `predev` and `prebuild` run it; it skips files already at their target. `node scripts/build-logs.mjs --check` verifies without writing |

The three demo commands need `pnpm build`, not just `pnpm build:wasm`: the app imports `@netgrep/netgrep`,
which resolves to this workspace and points at the gitignored `packages/netgrep/dist/`. This is why
`typecheck:example` is a separate script rather than part of `pnpm typecheck` — that one runs *before*
`pnpm build` in CI's `bundle` job.

CI groups these into five jobs by toolchain (§4.3). A red check names the group; the step list inside it
names the command, and that command is one of the above.

### 4.1 Working in a git worktree

```bash
pnpm worktree fix/chunk-boundary     # → ../netgrep-fix-chunk-boundary, ready to build
```

Creates the branch if it does not exist, places the worktree **beside** this checkout (never inside it — a
nested checkout would be picked up by the workspace glob, Biome and Vitest alike), and bootstraps it.

`pnpm bootstrap` inside an existing worktree does the same preparation. Both accept `--no-install`,
`--no-build` and `--no-browser` to skip a step.

**Rust builds are cached across worktrees, and you do not have to set it up** — provided `sccache` is on the
machine. Cargo otherwise keeps `target/` inside each worktree and recompiles the whole ripgrep dependency
tree into every one (~9s for the wasm32 release build, ~10s for the native test build). So
`scripts/cargo-cache.mjs` wraps the cargo and wasm-pack calls in `packages/search`'s scripts and sets
`RUSTC_WRAPPER=sccache` (plus `CARGO_INCREMENTAL=0`, which sccache requires). Measured on a fresh worktree
with a warm cache: wasm32 release **9.0s → 3.8s**, `cargo test --no-run` **10.1s → 4.4s**.

It works in a worktree created by `git worktree add` directly, which is the point — worktrees made by tooling
never run `pnpm bootstrap`. It steps aside, leaving the command untouched, when sccache is not installed
(then nothing changes and nothing is required of you), when `RUSTC_WRAPPER` is already set, when `CI` is set
(`Swatinem/rust-cache` already caches there), or when `NETGREP_CARGO_CACHE=0`.

> [!WARNING]
> **Do not point `CARGO_TARGET_DIR` at a directory shared by two worktrees**, however tempting — it is much
> faster (0.7s rather than 3.8s) and it silently runs the wrong binary. Both worktrees hold the same package
> at the same version, and Cargo's unit hash does not include the worktree path, so they collide on output
> filenames *and* fingerprint keys. Reproduced on 2026-07-29: after a build in one worktree, the other
> reported everything fresh in 0.03s and ran the first one's test binary — a 25-test suite replaced by a
> 2-test one, no recompile, no warning. CI cannot catch it; CI has one checkout. `CONTRIBUTING.md` and
> [decision 0012](docs/decisions/0012-worktree-bootstrap.md) used to recommend exactly this, and the advice
> has been retracted.

`target/` is still per-worktree, so **disk is not saved, only time**. There is still deliberately no
`.cargo/config.toml`. [Decision 0014](docs/decisions/0014-sccache-not-a-shared-target-dir.md) records all of
this. [`CONTRIBUTING.md`](CONTRIBUTING.md) is the human-facing version of this section.

### 4.2 The browser the tests run in

`pnpm test` runs the integration suite in **Playwright's own Chromium**, pinned to the `playwright` version in
the lockfile. `pnpm bootstrap` installs it; on its own that is:

```bash
pnpm exec playwright install chromium     # ~180 MB, once per machine
```

It lands in a shared per-user cache, not in the checkout, so worktrees share one copy.

Nothing depends on the Chrome installed on your machine. This replaced `wasm-pack test --chrome --headless`,
which downloaded the newest ChromeDriver, could not drive an older local Chrome, and **overrode**
`CHROMEDRIVER` so the mismatch was not fixable by hand. That whole failure mode is gone — browser and driver
now ship as one pinned unit. See [decision 0013](docs/decisions/0013-playwright-for-browser-tests.md).

### 4.3 What CI runs, and where a red check comes from

`test-and-lint.yml` is **five jobs grouped by toolchain**, so the check that goes red names the tools
involved and the step list inside it names the command:

| Job | Shows as | Waits for | Commands |
|---|---|---|---|
| `wasm` | Build WASM | — | `pnpm build:wasm`, then uploads `packages/search/pkg` as an artefact |
| `rust` | Rust (clippy + tests) | — | `pnpm lint:rust`, `pnpm test:rust` |
| `js` | JS (Biome + unit tests + docs) | — | `pnpm lint:js`, `pnpm test:unit`, `pnpm test:tools`, `pnpm docs:sync --check` |
| `browser` | Browser tests | `wasm` | `pnpm exec playwright install --with-deps chromium`, `pnpm test:browser` |
| `bundle` | Typecheck, build & package | `wasm` | `pnpm typecheck`, `pnpm build`, `pnpm verify:pack`, `pnpm typecheck:example`, `pnpm build:example` |
| `ci` | CI | all | Aggregate — **this is the check to require on the branch** |

**`test-and-lint.yml` no longer triggers on `push: main`.** It runs on pull requests, and `release.yml` calls
it on every push to `main`. That is one run per push where there used to be two — its own, plus the copy
`deploy-pages.yml` called — in two concurrency groups that could not cancel each other.

`release.yml` is the release pipeline, and the only thing that publishes anything:

| Job | Runs when | Does |
|---|---|---|
| `test-and-lint` | every push to `main` | `uses:` the graph above |
| `release-please` | it passed | Opens or updates the release PR; on a merged one, tags and creates the GitHub Release |
| `publish-search` | `packages/search--release_created` | `uses: publish-search.yml` |
| `publish-netgrep` | `packages/netgrep--release_created`, **after** `publish-search` | `uses: publish-netgrep.yml` |
| `deploy` | `releases_created` — **any** component | `uses: deploy-pages.yml` |

Three things about it are deliberate and easy to "fix" wrongly:

- **The tests run *before* `release-please`, which is the reverse of every release-please example.** The
  action tags unconditionally, so in the usual order a red `main` leaves a git tag and a public GitHub
  Release for a version that never reached npm. Here a tag only ever exists for a commit that went green.
- **Publishing happens in this run, not off a tag.** release-please tags with `GITHUB_TOKEN`, and GitHub
  refuses to trigger workflows from events pushed with it. A `push: tags` trigger would silently never fire —
  no error, no run, and you would find out from npm.
- **`publish-netgrep` needs `publish-search`.** That is hard rule 5, enforced rather than remembered.

The three called workflows trigger on `workflow_call` **and** `workflow_dispatch`, and none of them gates
itself on the test graph any more — `release.yml` does that once. The manual trigger exists because a publish
that fails *after* the tag was created cannot be retried by re-running `release.yml`: release-please reports
`release_created: false` the second time and every publish job skips. Each therefore refuses a manual run
whose ref is not `main`.

The demo's domain, `netgrep.diegopasquali.com`, is **not configured anywhere in this repository** — it is a
repository setting (Settings → Pages → Custom domain) plus a DNS record, and a `CNAME` file in the deployed
artefact would be ignored, because that mechanism is only for branch-based publishing. See
[decision 0017](docs/decisions/0017-example-as-hosted-demo.md#amendment-the-site-moved-to-netgrepdiegopasqualicom).

The WASM is built once and downloaded by the two jobs that need it. The two that need nothing from Rust do
not wait for it.

**Commands after a job's first carry `if: '!cancelled()'`**, so a clippy nit does not cost you the Rust test
results — the whole job runs and every failure in it shows up in one pass. Two deliberate exceptions: the
**first** command in a job is unguarded, so a broken checkout or a missing artefact stops there instead of
cascading into three identical failures; and `verify:pack`, `typecheck:example` and `build:example` are
unguarded because all three genuinely need `build` to have produced `dist/`. Keep both when adding a step.

Setup lives in two composite actions, `.github/actions/node` and `.github/actions/rust`; the second reads the
channel, targets and components out of `rust-toolchain.toml`, so the version is pinned in that file and
nowhere else. **Adding a job means adding it to `ci`'s `needs` list**, or it gates nothing.

Grouping by toolchain rather than one job per command is deliberate and measured: a job-per-command version
ran in 108s against ~110s sequential, for twice the runner time. **Parallelising CI here does not make it
faster** — read [decision 0015](docs/decisions/0015-ci-jobs-grouped-by-toolchain.md) before splitting it up
again.

---

## 5. Repository map

Three packages, ~530 lines of first-party source. pnpm workspaces link them; there is no task runner.

```
packages/
  search/            Rust → WASM core. The actual search engine.
    src/lib.rs         ~430 lines, mostly comment. Exports three functions,
                       sharing one compiled-matcher memo (decision 0016) and one
                       searcher, so a caller pays only for the mode it names:
                         search_bytes(&[u8], &str) -> Result<bool, JsError>
                         search_bytes_line(&[u8], &str, usize)
                             -> Result<Option<String>, JsError>   see decision 0020
                         search_bytes_line_ranges(&[u8], &str, usize)
                             -> Result<Option<LineWithRanges>, JsError>
                                                                  see decision 0022
    tests/search.rs    plain native `cargo test` — no browser, no WebDriver.
                       Ends with a `documented_defects` module; read §2.1 first
    scripts/post_build.js   fixes up the generated pkg/ (see below)
    package.json       hand-written wrapper; THIS is what gets published
    pkg/               BUILD OUTPUT, gitignored
    → published as @netgrep/search

  netgrep/           TypeScript wrapper. Streaming + batching.
    src/lib/Netgrep.ts               the whole public API (~470 lines)
    src/lib/splitAtLastLine.ts       the chunk-boundary tail arithmetic, pure and
                                     unit-tested on its own. NOT re-exported by
                                     index.ts — see decision 0018
    src/lib/data/*.ts                6 type definitions, one per file
    src/lib/Netgrep.spec.ts          unit suite; mocks fetch and the engine
    src/lib/Netgrep.integration.spec.ts   real WASM through the real streaming loop,
                                          in headless Chromium (§4.2)
    dist/              BUILD OUTPUT, gitignored
    → published as @netgrep/netgrep

  example/           THE PUBLIC DEMO — https://netgrep.diegopasquali.com/
                     Vite + React + Tailwind v4 + shadcn, a dashboard over four
                     generated log files totalling 408.6 MB (decision 0026). Not
                     published to npm; deployed to Pages on release.
    src/hooks/use-log-search.ts      the whole netgrep integration. Its timings are
                                     network timings — read the comment before
                                     changing what a repeat query costs
    src/lib/scan-meter.ts            DEMO-ONLY INSTRUMENTATION. Wraps window.fetch to
                                     count bytes per log file, because netgrep exposes
                                     no counter. Counts DECOMPRESSED content, not wire
                                     bytes — the page must keep saying which
    src/data/logs.ts                 the sources, read from logs.config.json, and the
                                     ONLY module that knows the base path
    src/App.tsx                      the demo page. It states no limitation of its
                                     own: the footer links to the guide's, which
                                     `pnpm docs:sync` generates
    index.html                       the DEMO entry: canonical, Open Graph, JSON-LD —
                                     spells the domain out in full; so do
                                     public/robots.txt and public/sitemap.xml.
                                     Nothing checks them
    docs/index.html                  the /docs entry. A second rollup input, not a
                                     route: no router, no React, no markdown parser
    plugins/guide-render.ts          pure renderers — markdown → HTML, the TOC, the
                                     site nav, the link rewriting. Unit-tested
    plugins/guide.ts                 the Vite plugin that reads docs/guide/ and
                                     splices the result into docs/index.html
    scripts/build-logs.mjs           tiles each seed up to its target from logs.config.json.
                                     `--check` verifies the built corpus without writing
    logs.config.json                 the four sources: id, service, seed, target, filename.
                                     Read by the generator AND by src/data/logs.ts
    seeds/                           four ~512 KB loghub-2.0 prefixes, CC BY 4.0, COMMITTED.
                                     See seeds/NOTICE.md — the attribution is an obligation
    public/logs/                     BUILD OUTPUT, gitignored, 408.6 MB. Generated by
                                     `prebuild`/`predev`; served as .txt so Pages gzips it
    → deployed by .github/workflows/deploy-pages.yml. See decision 0017

docs/guide/               THE CANONICAL PROSE. Seven numbered .md files, readable as
                          they are on GitHub and rendered into /docs at build time, plus
                          caveats.data.json — the one place a limitation is written.

scripts/verify-pack.mjs   Packaging guard, run in CI.
scripts/bootstrap.mjs     Prepares a checkout: install, browser, WASM (§4.1).
scripts/worktree.mjs      `git worktree add` + bootstrap, in one command.
scripts/docs-sync.mjs     Renders docs/guide/caveats.data.json onto the guide and the
                          README. `--check` writes nothing and fails CI (§2.3).
scripts/lib/              Its pure renderers and their tests, run by `pnpm test:tools`.
scripts/cargo-cache.mjs   Wraps cargo/wasm-pack so worktrees share one COMPILER cache,
                          via sccache. Each keeps its own target/ — sharing that is unsafe,
                          see §4.1 and decision 0014.

.github/workflows/        test-and-lint.yml, five jobs grouped by toolchain (§4.3);
                          release.yml, the pipeline that orchestrates everything
                          below; two npm publishes and deploy-pages.yml, all three
                          on workflow_call + workflow_dispatch.
release-please-config.json      What the three components are, how they version.
.release-please-manifest.json   Their current versions. WRITTEN BY THE BOT.
.github/actions/          Composite setup actions, `node` and `rust`, shared by those jobs.
```

Root config: `pnpm-workspace.yaml`, `Cargo.toml` (Rust workspace **and** the release profile — Cargo ignores
`[profile.*]` in member packages), `tsconfig.base.json`, `biome.jsonc`, `vitest.config.ts`,
`vitest.global-setup.ts` (the "run `pnpm build:wasm`" guard for the browser project), `rust-toolchain.toml`,
`.node-version`, `.github/workflows/`, `paseo.json` (tells the paseo worktree tool to run `pnpm bootstrap` on
a new worktree, so one class of tooling-created checkout arrives ready — §4.1). There is deliberately **no
`.cargo/config.toml`** — see §4.1.

### Two things about `packages/search` that surprise people

**The published package is not `pkg/`.** `pkg/` is wasm-pack's output; `packages/search/package.json` is a
hand-written wrapper that owns the npm name and includes `pkg/` via `"files"`. That indirection exists
because a workspace cannot glob a gitignored build output.

**`post_build.js` is load-bearing.** It marks `pkg/` as ESM, copies the version from `Cargo.toml` so the two
manifests cannot drift, and **deletes the `.gitignore` wasm-pack writes into `pkg/`** — that file contains
`*`, and npm honours it when packing, which once produced a tarball containing no WASM at all.

### Where to change what

| Goal | File |
|---|---|
| Matching semantics (regex flags, case sensitivity, binary handling) | `packages/search/src/lib.rs` |
| What a result contains | `packages/search/src/lib.rs` **and** `packages/netgrep/src/lib/data/NetgrepResult.ts`. Read [decision 0020](docs/decisions/0020-the-matching-line.md) and [0022](docs/decisions/0022-capture-ranges.md) first — 0022's table is the current list of what has been refused |
| Streaming, batching, abort behaviour | `packages/netgrep/src/lib/Netgrep.ts` |
| A config option | `packages/netgrep/src/lib/data/NetgrepSearchConfig.ts` — per-call, and the only configuration there is |
| Build or release steps | root `package.json` scripts, `packages/*/package.json` scripts, `.github/workflows/` |
| Binary size / release profile | root `Cargo.toml` — **not** `packages/search/Cargo.toml` |

---

## 6. Hard rules

1. **Version bumps and publishing are human-only.** The guarantee is unchanged; the mechanism is not.
   Releases are cut by **release-please**, and the human act is **merging its release PR** — that merge tags,
   publishes both packages and deploys the demo, with no further confirmation. You may never merge it, create
   a GitHub Release, dispatch a publish workflow, push a tag, or run `npm publish` / `wasm-pack publish`.
   `.claude/settings.json` denies all of these, including `gh pr merge`, `gh release create` and
   `gh workflow run`.

   **You may not edit version numbers by hand either.** `packages/search/Cargo.toml`,
   `packages/search/package.json`, `packages/netgrep/package.json`, `packages/example/package.json`, the root
   `Cargo.lock` and `.release-please-manifest.json` are all written by release-please. Editing one is how the
   two manifests drift, which `pnpm verify:pack` fails on.

   **Commit subjects now decide version numbers**, so they are part of this rule. Do not write a `!` breaking
   marker or a `Release-As:` footer unless you were explicitly asked to — `bump-minor-pre-major` caps a stray
   `!` at a minor bump rather than 1.0.0, but the number it produces is still published and cannot be taken
   back.

   **When a breaking change does have to be recorded, record it as a `BREAKING CHANGE:` footer in the commit
   body, never as a `!` on the subject.** Both produce the same bump under `bump-minor-pre-major`, but the
   footer keeps the subject line plain and states the migration in the changelog, and `!` is simply the form
   this repository does not use. `68ff771` — `feat(netgrep): replace captureLine with capture: 'line' |
   'line-ranges'` — is the example to copy.

2. **Never bump dependencies opportunistically.** A version change is its own deliberate, tested task, never
   a side effect of unrelated work. If a tool suggests an upgrade while you are doing something else, add it
   to [`docs/BACKLOG.md`](docs/BACKLOG.md) and move on.

   **When you do that task, commit it as `fix(search):` — not `chore:` — if it changes the bytes that ship.**
   `chore` neither releases nor appears in a changelog, and this repository's most consequential changes have
   historically been `chore`: dropping the ripgrep fork moved the `.wasm` by ~342 KB and silently fixed the
   `^`-anchoring bug. From a consumer's side that is a fix, and calling it one is what gets it published.
   Nothing enforces this.

   **There is deliberately no Renovate or Dependabot**, and adding one is not a maintenance task to pick up.
   On a repository maintained in bursts, per-dependency PRs become noise that gets ignored, which is worse
   than deliberate periodic review. Revisit only if the pinned versions start going stale in practice.

3. **The example is the public demo, and its dependencies ARE maintained.** It is published to GitHub Pages
   at <https://netgrep.diegopasquali.com/> **when a release is cut**, and CI typechecks and builds it on
   every PR. This **reverses** the exemption the package used to carry — the note in its `package.json`
   saying its dependencies were deliberately frozen is gone, not overlooked. See
   [decision 0017](docs/decisions/0017-example-as-hosted-demo.md).

   It used to deploy on every push to `main`, which meant the published demo ran code no consumer could
   install and its documentation could describe a library that was not on npm. It now shows what was
   released.

   **A consequence to write commits around: `docs:` does not release, so it does not deploy.** A change a
   visitor can see — copy, an image, a log seed — must be committed as `fix(example):` or `feat(example):`
   or it will sit on `main` until some other component happens to release. `docs:` is for repository
   documentation. Nothing enforces this.

   **The scope is necessary and not sufficient: release-please attributes a commit to a component by the
   PATHS it touches, not by the scope in its subject.** A `fix(example):` commit that only edits `docs/guide/`
   belongs to no component, so it produces no release and no deploy — and that is exactly the case this rule
   gets invoked for, since `/docs` is built from those files. Touch something under `packages/example/` in the
   same commit, or pair the guide edit with the demo change it goes with. Nothing enforces this either.

   It is still not a *correctness* check: nothing asserts what it renders. Correctness is established by
   `pnpm test`, `pnpm test:rust` and `pnpm verify:pack`. Rule 2 still applies to it — a version change is its
   own deliberate task.

4. **Do not commit build outputs or lockfile churn.** `packages/netgrep/dist/` and `packages/search/pkg/` are
   gitignored. If a command rewrites a lockfile as a side effect of something unrelated, revert it.

5. **Publish `@netgrep/search` before `@netgrep/netgrep`.** The dependency is `workspace:*`, which pnpm
   rewrites to a real version at pack time; the wrapper will not resolve if the core is not on npm yet.

   `release.yml` enforces this with a `needs:` edge, and the `linked-versions` plugin keeps the two on one
   version so they always release as a pair. The rule still matters when publishing by hand from the Actions
   UI, where nothing sequences them for you.

---

## 7. Known correctness caveats

Real, present in the published package, and **documented rather than fixed**. Each is pinned by a test that
asserts the wrong behaviour — in `Netgrep.integration.spec.ts`, and for the two that live in the engine also
in `packages/search/tests/search.rs`. Read §2.1 before touching any of them.

| | Where | Effect |
|---|---|---|
| Anchors and long matches inside a >64 KB line | `Netgrep.ts`, `MAX_TAIL_BYTES` | What remains of the chunk-boundary defect (**3g**). The retained tail is the incomplete trailing *line*, which is exact; past a 64 KB ceiling it degrades to a byte window. Inside such a line a match longer than 64 KB is lost, **and** `^` can match at the window's first byte. Needs a line over 64 KB — unreachable in prose. |
| One NUL discards the searched block | `lib.rs`, `BinaryDetection::quit` | A match is dropped even when it precedes the NUL. |
| `$` misses on CRLF input | `lib.rs`, no `.crlf(true)` | The line terminator is `\n`, so `\r` sits between the text and `$`. A `$`-anchored pattern silently misses on Windows-authored files. |

The last was found while broadening the test suite on 2026-07-29 and is backlog item 17.

**Three entries left this table on 2026-07-30.** Two were closed by
[decision 0018](docs/decisions/0018-line-oriented-tail-buffer.md): chunk-boundary false negatives and the
poisoned partial cache. They had to be fixed together, though not for the reason recorded here — the shared
"draining the stream destroys early resolution" is a failure mode of naive fixes, not a coupling. The real
coupling was that the boundary defect *suppressed* early resolution, so closing it alone would have made the
cache defect fire more often, in the default configuration.

The third was the duplicate fetch of item **18**, closed by
[decision 0019](docs/decisions/0019-in-flight-fetch-registry.md) with a per-url in-flight registry — and only
for instances running with the cache on, since the cache entry was what the second caller was handed. **It
came back on 2026-08-01 and stayed out of this table**:
[decision 0024](docs/decisions/0024-remove-the-in-memory-cache.md) removed the cache, so there is no entry to
hand over and two concurrent searches of one url each download it. That is now a design consequence rather
than a defect — pinned by an ordinary assertion, and published under *By design* rather than in the README's
defect list.

Decision 0018 also narrowed the row that remains: what the engine is handed is now a block of complete lines
rather than a network chunk, which changed the shape of the NUL defect's blast radius. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#known-limitations--correctness-caveats) and
[decision 0002](docs/decisions/0002-search-while-downloading.md).

---

## 8. Conventions

- **ESM only.** `"type": "module"`, and relative imports carry the **`.js` extension**
  (`./data/NetgrepResult.js`) even though the sources are `.ts`. `moduleResolution` is `nodenext`, which
  requires this. Match it.
- One type per file under `src/lib/data/`, named after the type.
- TSDoc on every public method and type. Keep that density.
- **Biome** formats and lints JS/TS (`biome.jsonc`); **rustfmt + clippy** for Rust, clippy with `-D warnings`.
- `.editorconfig` is authoritative for whitespace.
- Comments should explain *why*, especially where the code looks wrong but is not. The repository has several
  such places, and they are commented for a reason.
- **Keep them terse. Density is right; length is not.** Comment the same places, in fewer words: state the
  point in the first sentence and stop, prefer one dense sentence to three, and cut restatement and
  scene-setting. A long comment buries the thing it exists to say. Applies to TSDoc bodies and test comments
  too, not just inline `//`.
- **Comments must stand alone. Do not send the reader to a document to find the point.** No `see decision
  0018`, no `see caveat 2`, no `AGENTS.md §2.3` standing in for the reason. Say the thing:
  *"Deliberately not configurable — a safety valve for input netgrep is not aimed at, not a tuning knob."*
  **Test it by deleting the reference.** If the comment still teaches you what you needed, it was never
  carrying weight; if it collapses, write the missing sentence instead of the pointer.

  This is not the same rule as the one above, and it wins where they pull against each other: brevity is not a
  licence to replace an explanation with a citation. The long form still belongs in
  [`docs/decisions/`](docs/decisions/) — that is what keeps comments short — but the comment has to make sense
  to someone who never opens it.

  **Why:** cross-references rot silently and asymmetrically. Nothing checks them, and the code is edited far
  more often than the prose about it, so the pointer outlives the thing it pointed at. On 2026-07-30 four
  decision records, `ARCHITECTURE.md` and §2.3 of this file were all still describing a defect that had just
  been fixed. A comment that needed one of them to be read would have been actively misleading.

  **The one exception is a bare backlog item number**, which is a stable label rather than an explanation —
  `// BACKLOG 3a: searching these in isolation misses a word that continues in the next chunk.` The numbers
  never change (see [`docs/BACKLOG.md`](docs/BACKLOG.md)) and §2.1's defect-test traceability is built on them.
  The sentence after the label still has to do the explaining.

---

## 9. Further reading

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, data flow, build/release pipeline, known limitations |
| [`docs/decisions/`](docs/decisions/) | Why the system is shaped this way — one record per decision |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Sanctioned maintenance work, prioritised |
| [`docs/guide/`](docs/guide/) | The canonical usage prose. Audience is consumers; rendered to `/docs` at build time and readable as-is on GitHub. |
| [`README.md`](README.md) | Landing page: what netgrep is, one example, the defect list, and links onward. The reference used to live here and no longer does. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Human on-ramp: prerequisites, first run, worktrees, PR checklist. Points here for depth. |
