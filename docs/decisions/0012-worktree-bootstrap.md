# 0012 — A bootstrap script, and no build-cache configuration in the repository

**Status:** Accepted (2026-07-29).

## Context

A `git worktree` of this repository, and a fresh clone, are unusable on arrival. Three things they need are
untracked build state:

| | Cost in a new checkout |
|---|---|
| `node_modules/` | one `pnpm install`; cheap, the pnpm store is global and hardlinked |
| `packages/search/pkg/` | must be built — see [0009](0009-pnpm-workspaces.md) and `AGENTS.md` §2.2 |
| `target/` | the whole ripgrep dependency tree, compiled again, kept again |

The second is a trap rather than a cost: forgetting it makes `pnpm typecheck`, `pnpm build` and the
integration tests fail in ways that point anywhere except at a missing WASM build.

The third is a genuine duplication. Cargo keeps `target/` inside each worktree, so every worktree recompiles
the same dependencies. Measured here: ~8s for the release profile, ~5s more for clippy's dev profile, and a
directory that reaches 1.2 GB once `wasm-pack test` artefacts land in it — per worktree.

## Decision

**`pnpm bootstrap`** prepares a checkout: `pnpm install --frozen-lockfile`, then `pnpm build:wasm`. It is
idempotent. **`pnpm worktree <branch>`** adds a worktree beside the main checkout and bootstraps it.

**The repository configures no build cache.** Sharing Cargo artefacts across worktrees is a one-line
environment variable in the developer's shell (`CARGO_TARGET_DIR`, or `RUSTC_WRAPPER=sccache`), documented in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md). `bootstrap.mjs` reports what it finds and suggests the variable
when more than one worktree exists; it writes nothing.

### What was built first, and why it was dropped

The first version generated a gitignored `.cargo/config.toml` pointing `build.target-dir` at
`<git-common-dir>/cargo-target`, shared by every worktree. It worked: a new worktree compiled only the
`search` crate, 0.38s against the warm cache, and a clippy run in one worktree warmed the next run in another
to 0.02s. One 143 MB directory replaced a 1.2 GB one per worktree.

`CARGO_TARGET_DIR` was then measured to do the same job: a cold dependency build in one worktree (11s, 26
crates) left the other needing 0.02s.

It was dropped after looking at what comparable JS+Rust projects actually do:

| Project | Rust build cache | JS task cache | `.cargo/config.toml` |
|---|---|---|---|
| oxc | `Swatinem/rust-cache` + Namespace remote cache | none | committed — rustflags, linker |
| biome | `moonrepo/setup-rust`, `cache-base: main` | none | — |
| swc | none; `CARGO_INCREMENTAL: 0` | none (pnpm store only) | — |
| rspack | — | none | committed — rustflags, clippy lints |
| rolldown | — | none | committed — rustflags, target features |

Three things are consistent across all of them. **Nobody unifies the two caches** — Cargo owns Rust, the
package manager owns JS, and no monorepo tool bridges them, which is the same conclusion
[0007](0007-nx-cargo-hybrid-monorepo.md) reached from the other direction. **All the investment is in CI**,
via an off-the-shelf action keyed on the *default* `target/`. And while every one of them commits
`.cargo/config.toml`, **not one sets `build.target-dir` or `rustc-wrapper`** — what gets committed is
machine-agnostic (rustflags, linker args, target features), and machine-specific caching lives in the
developer's environment.

The generated file was the outlier, and it was carrying real weight: a gitignore entry, a proposed
`postinstall` hook to apply it in worktrees nobody bootstrapped by hand, a `CI` guard on that hook so it could
not orphan `Swatinem/rust-cache`, and a clobber check so it would not eat a hand-written config. All of it
existed to distribute one machine-specific path. `export CARGO_TARGET_DIR=…` does the same job, is inherited
by subprocesses and agent-spawned worktrees for free, and costs the repository nothing.

## Consequences

**Good:**
- One command from `git worktree add` to a checkout that builds and tests.
- The repository owns no machine-specific build configuration, and nothing silently redirects a build.
- CI is unaffected by construction — there is no configuration for it to pick up.
- The measured saving is still available; it moved to a documented line in a shell profile.

**Costs:**
- The cache is opt-in and per-machine, so it is invisible to anyone who clones and does not read
  `CONTRIBUTING.md`. `bootstrap.mjs` mentions it when a second worktree exists, which is when it starts to
  matter.
- `CARGO_TARGET_DIR` has the two properties the generated config had: Cargo **locks** the target directory, so
  simultaneous builds in two worktrees serialize; and the directory grows unbounded, with no eviction.
  `sccache` avoids both, at the cost of an unpinned binary, `CARGO_INCREMENTAL=0`, and no caching of the
  `cdylib` this crate produces (the dependencies, which are the expensive part, do cache).
- `pnpm worktree` can only bootstrap branches that *contain* `scripts/bootstrap.mjs`. For an older branch it
  creates the worktree, says what it skipped, and stops.

**Deliberately not done:** sharing `node_modules` between worktrees. pnpm's store already makes installs
hardlink-cheap (1.7s measured), and a shared `node_modules` would break the moment two branches disagreed
about a dependency.
