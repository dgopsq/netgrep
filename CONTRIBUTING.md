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
pnpm test          # Vitest — 24 tests (7 in Node, 17 in headless Chromium)
pnpm test:rust     # cargo test — 2 tests, native, no browser
pnpm typecheck     # tsc --noEmit
pnpm lint          # Biome (JS/TS) and clippy (-D warnings)
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

### Sharing a build cache

Cargo keeps its `target/` **inside each worktree**, so every worktree compiles the ripgrep dependency tree
again and keeps its own copy — measured here at ~8s for the release profile, ~5s more for clippy's dev
profile, and a directory that runs to hundreds of megabytes per worktree. (It used to reach 1.2 GB, when
`wasm-pack test` dropped a browser-test toolchain in there too; see
[decision 0013](docs/decisions/0013-playwright-for-browser-tests.md).)

If you keep more than one worktree around, share one cache by exporting a variable from your shell profile:

```bash
export CARGO_TARGET_DIR="$HOME/.cache/cargo-shared"
```

A new worktree then compiles only the `search` crate — under half a second measured, against ~8s for a cold
dependency build. Two things to know: Cargo **locks** the target directory, so two worktrees building at the same instant serialize; and the
directory grows without bound, so prune it occasionally (`cargo sweep` if you want that automated).

The alternative is [sccache](https://github.com/mozilla/sccache) via `RUSTC_WRAPPER`, which keeps a bounded,
self-evicting cache and does not serialize parallel builds. It cannot cache the `cdylib` this crate produces,
but it does cache the dependencies, which is where the cost is; it also requires `CARGO_INCREMENTAL=0`.

**Keep this in your environment, not in the repository.** A committed `build.target-dir` would have to be an
absolute path, and a committed `rustc-wrapper` would make sccache mandatory for everyone including CI — where
the caching actions assume the default `target/`. [Decision 0012](docs/decisions/0012-worktree-bootstrap.md)
records why, and what the comparable JS+Rust projects do.

## Before opening a pull request

```bash
pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm verify:pack
```

That is the order CI runs them in. `pnpm build` is not optional here even though nothing else needs it:
`verify:pack` inspects the tarballs that would reach npm, and `packages/netgrep/dist/` has to exist first.

Then, in rough order of how likely each is to bite:

- **Some tests assert behaviour that is deliberately wrong.** `Netgrep.integration.spec.ts` ends with a block
  titled *documented defects*, pinning known bugs — a match straddling a chunk boundary returning `false`, a
  NUL byte discarding a chunk. If one fails, something changed the engine; work out what, and if the new
  behaviour is right, **invert the assertion in the same PR** with a note. Do not quietly "fix" the test.
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
