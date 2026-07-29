# Contributing

netgrep is an **experiment**, and it is maintained conservatively: fix defects, keep dependencies from
rotting, keep it working for existing consumers. **New features are out of scope** — the public API is
deliberately one boolean per URL, and widening it is a design conversation rather than a pull request. See
[`docs/BACKLOG.md`](docs/BACKLOG.md) for work that is already sanctioned.

[`AGENTS.md`](AGENTS.md) is the authoritative guide to this repository — toolchain pins, the repository map,
the hard rules, the known correctness caveats. This file is the short human on-ramp; where the two overlap,
AGENTS.md wins.

## Prerequisites

Everything is pinned in a file, so you should not need to pick versions.

| Tool | Version | Where it comes from |
|---|---|---|
| Node | 24.18.0 | `.node-version` — `fnm use`, `nvm use`, or your manager of choice |
| pnpm | 11.17.0 | `corepack enable`, then it reads `packageManager` in `package.json` |
| Rust | 1.97.1 | `rust-toolchain.toml` — rustup installs it on first `cargo` call |
| wasm-pack | 0.13.1 | `cargo install wasm-pack` — the one tool you install by hand |

## First run

```bash
pnpm bootstrap
```

That is `pnpm install` followed by `pnpm build:wasm`. **Do not skip the second half.** `@netgrep/netgrep`
resolves `@netgrep/search` to this workspace, and that package points at `packages/search/pkg/` — a gitignored
build output that does not exist on a fresh clone. Until you build it, `pnpm typecheck`, `pnpm build` and the
integration tests all fail in ways that look like anything except a missing WASM build. This is the single
most common way to lose an hour here.

## Commands

All from the repository root. [AGENTS.md §4](AGENTS.md#4-commands) has the full list and the caveats.

```bash
pnpm test          # Vitest — 58 tests (30 in Node, 28 in headless Chromium)
pnpm test:unit     # just the Node half — no WASM build and no browser needed
pnpm test:browser  # just the browser half
pnpm test:rust     # cargo test — 25 tests, native, no browser
pnpm typecheck     # tsc --noEmit
pnpm lint          # Biome (JS/TS) and clippy (-D warnings); lint:js / lint:rust run one each
pnpm format        # Biome, writes in place
pnpm build:wasm    # rebuild after any change to packages/search
pnpm dev           # the Sherlock Holmes demo — a manual smoke test, not a test
```

The integration half of `pnpm test` drives the real WASM engine in a real browser, so it needs Playwright's
Chromium. `pnpm bootstrap` installs it; on its own it is:

```bash
pnpm exec playwright install chromium     # ~180 MB, once per machine
```

It is pinned to the `playwright` version in the lockfile and is unrelated to the Chrome you have installed,
so it cannot fall out of step with its driver. That used to be this repository's most annoying local failure
— see [decision 0013](docs/decisions/0013-playwright-for-browser-tests.md).

## Working on several branches at once

```bash
pnpm worktree fix/chunk-boundary
```

Creates the branch if it does not exist, adds a git worktree **beside** this checkout (never inside it — a
nested checkout would be picked up by the pnpm workspace glob, Biome and Vitest alike), and bootstraps it.
`pnpm bootstrap` inside an existing worktree does the same preparation. Both take `--no-install`,
`--no-build` and `--no-browser`.

### Sharing the Rust build cache

Install [sccache](https://github.com/mozilla/sccache) once and every worktree stops recompiling the ripgrep
dependency tree:

```bash
brew install sccache        # or: cargo install sccache
```

That is the whole setup — no variable to export, no config to write. The `build`, `test` and `lint` scripts
of `packages/search` go through `scripts/cargo-cache.mjs`, which sets `RUSTC_WRAPPER=sccache` for you when it
finds it (along with `CARGO_INCREMENTAL=0`, which sccache requires). It prints one line when it engages, so a
build going through a wrapper you did not configure is never a mystery. Measured on a fresh worktree with a
warm cache:

| | Cold | With sccache |
|---|---|---|
| `pnpm build:wasm`'s cargo step | 9.0s | **3.8s** |
| `pnpm test:rust`'s compile | 10.1s | **4.4s** |

Without sccache, nothing changes and nothing breaks — it is an optimisation, not a requirement. It also works
in a worktree you created with plain `git worktree add`, which is the point: worktrees created by tooling
never run `pnpm bootstrap`.

Your environment wins: the wrapper leaves the command completely alone if `RUSTC_WRAPPER` is already set, and
`NETGREP_CARGO_CACHE=0` opts out entirely.

Note this saves **time, not disk** — each worktree still keeps its own `target/`. `cargo clean` in a worktree
reclaims that one; sccache's own cache is bounded and evicts itself.

> [!WARNING]
> **Do not share one `CARGO_TARGET_DIR` between worktrees.** This file used to recommend exactly that, and
> the advice was wrong. Two worktrees of this repository hold the same package at the same version, and
> Cargo's unit hash does not include the worktree path, so they collide on both output filenames and
> fingerprint keys — build in one worktree and the other reports everything fresh and **runs the first one's
> binary**. Reproduced here: a 25-test suite silently replaced by a 2-test one, in 0.03s, with no recompile
> and no warning. Touching a source file recovers it, which is what makes it dangerous. If you have this in
> your shell profile, remove it.
>
> [Decision 0014](docs/decisions/0014-sccache-not-a-shared-target-dir.md) has the full write-up and the
> retraction of [0012](docs/decisions/0012-worktree-bootstrap.md)'s version of the advice.

## Before opening a pull request

```bash
pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:rust && pnpm verify:pack
```

That is everything CI checks. `pnpm build` is not optional here even though nothing else needs it:
`verify:pack` inspects the tarballs that would reach npm, and `packages/netgrep/dist/` has to exist first.

CI runs each of these as **its own job**, so a red check names the command rather than the workflow — and
`pnpm lint:js`, `pnpm lint:rust`, `pnpm test:unit` and `pnpm test:browser` reproduce one job at a time. See
[AGENTS.md §4.3](AGENTS.md#43-what-ci-runs-and-where-a-red-check-comes-from).

Then, in rough order of how likely each is to bite:

- **Some tests assert behaviour that is deliberately wrong.** `Netgrep.integration.spec.ts` ends with a block
  titled *documented defects*, and `packages/search/tests/search.rs` with a `documented_defects` module. They
  pin known bugs — a match straddling a chunk boundary returning `false`, a NUL byte discarding a chunk. If
  one fails, something changed the engine; work out what, and if the new behaviour is right, **invert the
  assertion in the same PR** with a note. Do not quietly "fix" the test.
  [AGENTS.md §2.1](AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose) has the full story.
- **Do not bump dependencies as a side effect.** A version change is its own deliberate, tested change. If a
  tool suggests one while you are doing something else, add it to `docs/BACKLOG.md`.
- **Do not commit build outputs or lockfile churn.** `packages/netgrep/dist/` and `packages/search/pkg/` are
  gitignored; if a command rewrites `pnpm-lock.yaml` incidentally, revert it.
- **ESM only, and relative imports carry a `.js` extension** even though the sources are `.ts`.
  `moduleResolution` is `nodenext`, which requires it.
- **Comments explain *why*.** Several places in this repository look wrong and are not; they are commented
  for a reason. Keep that density.

Releases fire from pushed git tags and publish under the maintainer's npm token. **Version bumps and
publishing are maintainer-only** — please do not include them in a pull request.

## Where things live

[AGENTS.md §5](AGENTS.md#5-repository-map) maps the three packages and says which file to change for which
kind of goal. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the design and the known correctness
caveats; [`docs/decisions/`](docs/decisions/) explains why the system is shaped the way it is.
