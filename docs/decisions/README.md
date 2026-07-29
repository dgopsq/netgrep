# Decision records

One file per architectural decision, explaining **why** netgrep is shaped the way it is.

Records 0001–0008 are reconstructed from the code, git history and the public README as of 2026-07-28. Where
the original rationale was not recorded anywhere, the record says so explicitly rather than inventing one —
treat those sections as inference, not testimony. Records 0009 onwards were written as the decisions were
made.

Superseded records are **kept, not deleted**. They explain why the code looked the way it did, which stays
useful after the fact; each carries an *Outcome* section saying what replaced it and what the original
reasoning got wrong.

| # | Decision | Status |
|---|---|---|
| [0001](0001-fork-ripgrep-for-wasm.md) | Depend on a fork of ripgrep to reach `wasm32` | **Superseded** — fork dropped; the problem stopped existing |
| [0002](0002-search-while-downloading.md) | Search each HTTP chunk as it arrives | Accepted — the project's defining property |
| [0003](0003-boolean-only-results.md) | Return a boolean, not match details | Accepted |
| [0004](0004-two-package-split.md) | Ship two npm packages, not one | Accepted — amended |
| [0005](0005-esm-only-distribution.md) | ESM only | Accepted — amended; **a bundler is no longer configured** |
| [0006](0006-in-memory-cache.md) | Cache downloaded bytes in memory, on by default | Accepted — **has known defects** |
| [0007](0007-nx-cargo-hybrid-monorepo.md) | Nx orchestrating both JS and Cargo | **Superseded** by 0009 |
| [0008](0008-wee-alloc.md) | `wee_alloc` as the WASM global allocator | **Superseded** — removed; worth only 0.6% |
| [0009](0009-pnpm-workspaces.md) | pnpm workspaces, and a hand-written manifest for the WASM package | Accepted |
| [0010](0010-vitest-and-biome.md) | Vitest and Biome replace jest, ts-jest, ESLint and Prettier | Accepted |
| [0011](0011-tests-that-assert-known-bugs.md) | Tests that deliberately assert incorrect behaviour | Accepted |
| [0012](0012-worktree-bootstrap.md) | A bootstrap script, and no build-cache configuration in the repository | Accepted — **build-cache half superseded** by 0014, which **retracts this record's `CARGO_TARGET_DIR` advice as unsafe** |
| [0013](0013-playwright-for-browser-tests.md) | Playwright runs the browser tests; ChromeDriver is gone | Accepted |
| [0014](0014-sccache-not-a-shared-target-dir.md) | Cache Rust builds with sccache, and never with a shared target directory | Accepted |
| [0015](0015-ci-jobs-grouped-by-toolchain.md) | Five CI jobs, grouped by toolchain, with the WASM built once | Accepted |
| [0016](0016-compiled-matcher-memo.md) | Cache the compiled matcher inside Rust, rather than hand a handle to JavaScript | Accepted |

## Format

Each record: **Context** (the forces), **Decision** (what was chosen), **Consequences** (what it costs), and
where relevant **Current assessment** / **Outcome** / **Amendment** (what has changed since). Keep them short.

Adding one: next free number, update this table, link it from
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) if it explains something structural.
