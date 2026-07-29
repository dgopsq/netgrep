# AGENTS.md

Operating guide for AI agents working in the **netgrep** repository.
Canonical source — `CLAUDE.md` points here. Keep this file authoritative; do not fork its content.

Everything below was verified end-to-end on **2026-07-29** (macOS arm64, Node 24.18.0, Rust 1.97.1).

---

## 1. What this project is

netgrep is a port of [ripgrep](https://github.com/BurntSushi/ripgrep) to WebAssembly that searches remote
files **over HTTP while they are still downloading**. It answers exactly one question: *does this pattern
occur in the file at this URL?* — a boolean, nothing more.

The intended use case is a client-side search over a small, static, file-based corpus (e.g. Markdown posts
emitted by a static site generator), instead of standing up an index-based search backend.

**It is an experiment, and the README says so first.** netgrep is not claimed to be a good way to build
search — a prebuilt index (Pagefind, Lunr, FlexSearch, a hosted service) is usually smaller, faster and more
capable, and can rank, snippet and locate matches, none of which netgrep does. What the project explores is
the narrower question of whether ripgrep's real engine can usefully run over HTTP against files as they
download. Keep that framing when you touch user-facing text: describe what it does and what it costs, and do
not sell it.

**Project status: maintained, conservative.** The toolchain is current and CI is green. Keep it that way:
fix defects, keep dependencies from rotting, keep it working for existing consumers. **Do not add features.**
The public API is deliberately small — a boolean per URL — and widening it (match positions, line numbers,
Node support) is a design conversation, not a task to pick up. See [`docs/BACKLOG.md`](docs/BACKLOG.md) for
sanctioned work.

---

## 2. ⚠️ Read this before you edit anything

Three things will mislead you if you do not know them.

### 2.1 Some tests assert behaviour that is WRONG, on purpose

`packages/netgrep/src/lib/Netgrep.integration.spec.ts` ends with a block titled
**`documented defects (asserting current, incorrect behaviour)`**. Those assertions pin known bugs — a pattern
straddling a chunk boundary returning `false`, a NUL byte discarding a chunk, and so on.
`packages/search/tests/search.rs` has a `documented_defects` module doing the same for the ones that live in
the engine, where a failure names `lib.rs` without a browser and a stream in the way.

They are not mistakes and they are not out of date. Their job is to detect *unintended* change during
dependency work: a test asserting the correct-but-unimplemented behaviour would fail today and tell us
nothing.

**If one of them fails, that is a signal, not a nuisance.** Something changed the engine's behaviour. Find out
what, decide whether the new behaviour is right, and if it is, **invert the assertion in the same PR** with a
note saying why. Do not "fix" a defect test to make CI green, and do not fix the underlying bug without
inverting its test in the same change.

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

The example is a **published web page** — <https://netgrep.diegopasquali.com/> — and its "Scope" section tells
visitors what netgrep cannot do. A fix that leaves that list alone puts the project in the worst possible
position: a live site confidently warning the world about a bug that no longer exists. The site's only value
is that it is accurate, so stale honesty is worse than none.

**So a change to library behaviour is incomplete until the site agrees with it.** This is the same rule as
§2.1 and it fires on the same commits: fixing a defect means inverting its test *and* updating the site, both
in the PR that fixes it.

**Nothing enforces this.** No test fails, CI stays green, and the site keeps lying until a human notices. That
is exactly why it is in this section rather than in a comment somewhere.

| If you… | Then, in the same PR… |
|---|---|
| Fix 3a, 3b, 3f, 17 or 18 | Remove or rewrite its entry in the `CAVEATS` array of [`packages/example/src/components/limitations.tsx`](packages/example/src/components/limitations.tsx) |
| Fix **both** 3b and 18 | Also re-enable the cache in `packages/example/src/hooks/use-corpus-search.ts` and delete the "This demo runs with the cache off" caveat — the workaround exists only because of those two |
| Add a new defect to `docs/BACKLOG.md` | Decide whether a visitor is affected. If so, add a caveat; if not, no action — but make it a decision, not an omission |
| Change what netgrep returns or costs | Check the hero copy and the `StatsBar` line, which state "one boolean per file" and the 1.15 MB WebAssembly download |

**The four caveats currently on the site map to backlog items like this**, so you can find yours quickly:

| Caveat on the site | Backlog |
|---|---|
| One boolean per file | *none* — by design, [decision 0003](docs/decisions/0003-boolean-only-results.md). Will never be "fixed" |
| Matches spanning two network chunks are missed | **3a** |
| This demo runs with the cache off | **3b** and **18** |
| Binary files stop at the first NUL | **3f** |

Item **17** (`$` on CRLF input) is deliberately *not* on the site: every file in the demo corpus is LF, so it
cannot be triggered there. If the corpus ever gains a CRLF file, it needs a caveat.

**Do not delete a caveat to tidy the page.** The list is short because the defects are few, not because the
page is being edited for length — and it is the only reason a visitor has to trust the rest of it.

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
| Build WASM | `pnpm build:wasm` | → `packages/search/pkg/`, ~1.15 MB `index_bg.wasm` |
| Build TS | `pnpm build` | → `packages/netgrep/dist/` |
| Lint | `pnpm lint` | Biome (JS/TS) **and** clippy (`-D warnings`); `lint:js` / `lint:rust` run one each |
| Format | `pnpm format` | Biome, writes in place |
| Typecheck | `pnpm typecheck` | `tsc --noEmit`, TypeScript 7 |
| Test TS | `pnpm test` | Vitest — **59 tests**: 30 unit in Node, 29 integration in headless Chromium |
| — one suite | `pnpm test:unit` / `pnpm test:browser` | The two Vitest projects separately. `test:unit` needs no WASM and no browser |
| Test Rust | `pnpm test:rust` | `cargo test`, native, no browser — **28 tests** |
| Verify packaging | `pnpm verify:pack` | Packs both packages and inspects the tarballs. **Needs `pnpm build` first** |
| Run the demo | `pnpm dev` | Vite, at <http://localhost:5173/>. **Needs `pnpm build` first** — see below |
| Typecheck the demo | `pnpm typecheck:example` | Separate from `pnpm typecheck`; **needs `pnpm build` first** |
| Build the demo | `pnpm build:example` | → `packages/example/dist/`. **Needs `pnpm build` first** |
| Regenerate the corpus manifest | `pnpm --filter @netgrep/example manifest` | After adding or removing a story file |

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

| Job | Waits for | Commands |
|---|---|---|
| `wasm` | — | `pnpm build:wasm`, then uploads `packages/search/pkg` as an artefact |
| `rust` | — | `pnpm lint:rust`, `pnpm test:rust` |
| `js` | — | `pnpm lint:js`, `pnpm test:unit` |
| `browser` | `wasm` | `pnpm exec playwright install chromium`, `pnpm test:browser` |
| `bundle` | `wasm` | `pnpm typecheck`, `pnpm build`, `pnpm verify:pack`, `pnpm typecheck:example`, `pnpm build:example` |
| `ci` | all | Aggregate — **this is the check to require on the branch** |

A sixth workflow, `deploy-pages.yml`, publishes the demo to GitHub Pages on every push to `main`. It is not
one of these jobs: it `uses:` this whole workflow and gates on it, the way the two publish workflows do.

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
    src/lib.rs         ~135 lines, mostly comment. Exports one function:
                       search_bytes(&[u8], &str) -> Result<bool, JsError>, which caches
                       the last compiled matcher. See decision 0016
    tests/search.rs    plain native `cargo test` — no browser, no WebDriver.
                       Ends with a `documented_defects` module; read §2.1 first
    scripts/post_build.js   fixes up the generated pkg/ (see below)
    package.json       hand-written wrapper; THIS is what gets published
    pkg/               BUILD OUTPUT, gitignored
    → published as @netgrep/search

  netgrep/           TypeScript wrapper. Streaming + batching + caching.
    src/lib/Netgrep.ts               the whole public API (~225 lines)
    src/lib/data/*.ts                5 type definitions, one per file
    src/lib/Netgrep.spec.ts          unit suite; mocks fetch and the engine
    src/lib/Netgrep.integration.spec.ts   real WASM through the real streaming loop,
                                          in headless Chromium (§4.2)
    dist/              BUILD OUTPUT, gitignored
    → published as @netgrep/netgrep

  example/           THE PUBLIC DEMO — https://netgrep.diegopasquali.com/
                     Vite + React + Tailwind v4 + shadcn, searching 56 Sherlock Holmes
                     .txt files. Not published to npm; deployed to Pages on push to main.
    src/hooks/use-corpus-search.ts   the whole netgrep integration. Runs with the
                                     memory cache OFF on purpose — read the comment
    src/lib/story-url.ts             the ONLY module that knows the base path
    index.html                       canonical, Open Graph, JSON-LD — spells the
                                     domain out in full; so do public/robots.txt
                                     and public/sitemap.xml. Nothing checks them
    scripts/build-manifest.mjs       regenerates src/data/stories.ts from public/stories/
    public/stories/                  the corpus, 56 files, 2.6 MB
    → deployed by .github/workflows/deploy-pages.yml. See decision 0017

scripts/verify-pack.mjs   Packaging guard, run in CI.
scripts/bootstrap.mjs     Prepares a checkout: install, browser, WASM (§4.1).
scripts/worktree.mjs      `git worktree add` + bootstrap, in one command.
scripts/cargo-cache.mjs   Wraps cargo/wasm-pack so worktrees share one COMPILER cache,
                          via sccache. Each keeps its own target/ — sharing that is unsafe,
                          see §4.1 and decision 0014.

.github/workflows/        Five jobs grouped by toolchain (§4.3), two npm publishes,
                          and deploy-pages.yml for the demo site.
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
| What a result contains | `packages/search/src/lib.rs` **and** `packages/netgrep/src/lib/data/NetgrepResult.ts` |
| Streaming, batching, caching, abort behaviour | `packages/netgrep/src/lib/Netgrep.ts` |
| A config option | `packages/netgrep/src/lib/data/NetgrepConfig.ts` or `NetgrepSearchConfig.ts` |
| Build or release steps | root `package.json` scripts, `packages/*/package.json` scripts, `.github/workflows/` |
| Binary size / release profile | root `Cargo.toml` — **not** `packages/search/Cargo.toml` |

---

## 6. Hard rules

1. **Version bumps and publishing are human-only.** Releases fire from pushed git tags (`netgrep-**`,
   `search-**`) and publish to npm under the maintainer's token. You may *prepare* a release; you may never
   trigger one, push a release tag, or run `npm publish` / `wasm-pack publish`. `.claude/settings.json`
   denies these outright.

2. **Never bump dependencies opportunistically.** A version change is its own deliberate, tested task, never
   a side effect of unrelated work. If a tool suggests an upgrade while you are doing something else, add it
   to [`docs/BACKLOG.md`](docs/BACKLOG.md) and move on.

   **There is deliberately no Renovate or Dependabot**, and adding one is not a maintenance task to pick up.
   On a repository maintained in bursts, per-dependency PRs become noise that gets ignored, which is worse
   than deliberate periodic review. Revisit only if the pinned versions start going stale in practice.

3. **The example is the public demo, and its dependencies ARE maintained.** It is published to GitHub Pages
   at <https://netgrep.diegopasquali.com/> on every push to `main`, and CI typechecks and builds it. This
   **reverses** the exemption the package used to carry — the note in its `package.json` saying its
   dependencies were deliberately frozen is gone, not overlooked. See
   [decision 0017](docs/decisions/0017-example-as-hosted-demo.md).

   It is still not a *correctness* check: nothing asserts what it renders. Correctness is established by
   `pnpm test`, `pnpm test:rust` and `pnpm verify:pack`. Rule 2 still applies to it — a version change is its
   own deliberate task.

4. **Do not commit build outputs or lockfile churn.** `packages/netgrep/dist/` and `packages/search/pkg/` are
   gitignored. If a command rewrites a lockfile as a side effect of something unrelated, revert it.

5. **Publish `@netgrep/search` before `@netgrep/netgrep`.** The dependency is `workspace:*`, which pnpm
   rewrites to a real version at pack time; the wrapper will not resolve if the core is not on npm yet.

---

## 7. Known correctness caveats

Real, present in the published package, and **documented rather than fixed**. Each is pinned by a test that
asserts the wrong behaviour — in `Netgrep.integration.spec.ts`, and for the two that live in the engine also
in `packages/search/tests/search.rs`. Read §2.1 before touching any of them.

| | Where | Effect |
|---|---|---|
| Chunk-boundary false negatives | `Netgrep.ts` search loop | A match spanning two `fetch` chunks is never found. Silent, non-deterministic. |
| Poisoned partial cache | `Netgrep.ts` cache paths | Early resolution caches a prefix; later searches answer `false` for text never downloaded. |
| One NUL discards the chunk | `lib.rs`, `BinaryDetection::quit` | A match is dropped even when it precedes the NUL. |
| `$` misses on CRLF input | `lib.rs`, no `.crlf(true)` | The line terminator is `\n`, so `\r` sits between the text and `$`. A `$`-anchored pattern silently misses on Windows-authored files. |
| Concurrent searches double a cache entry | `Netgrep.ts`, no in-flight tracking | Two searches of one url started together both fetch and both append, so the entry holds the file twice — joined with no separator, forming a line the file never had. |

The last two were found while broadening the test suite on 2026-07-29 and are backlog items 17 and 18.

The first two **interact** — fixing either naively (by draining the stream) destroys the early-resolution
property that is the whole point of the project. See
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

---

## 9. Further reading

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, data flow, build/release pipeline, known limitations |
| [`docs/decisions/`](docs/decisions/) | Why the system is shaped this way — one record per decision |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Sanctioned maintenance work, prioritised |
| [`README.md`](README.md) | Public-facing usage docs. Audience is consumers, not contributors. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Human on-ramp: prerequisites, first run, worktrees, PR checklist. Points here for depth. |
