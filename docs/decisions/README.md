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
| [0003](0003-boolean-only-results.md) | Return a boolean, not match details | Accepted — amended by 0020 (**the first matching line is available on request**; everything else is still refused) |
| [0004](0004-two-package-split.md) | Ship two npm packages, not one | Accepted — amended |
| [0005](0005-esm-only-distribution.md) | ESM only | Accepted — amended; **a bundler is no longer configured** |
| [0006](0006-in-memory-cache.md) | Cache downloaded bytes in memory, on by default | Accepted — amended by 0018 (**an entry is written only from a drained stream**, which closed the poisoned-prefix defect) and by 0019 (**the flag now also decides whether concurrent downloads of one url are shared**) |
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
| [0017](0017-example-as-hosted-demo.md) | The example becomes the hosted demo, and goes back on the maintenance path | Accepted — **reverses the example's frozen-dependency exemption**; amended — custom domain, base path now `/` |
| [0018](0018-line-oriented-tail-buffer.md) | Retain the incomplete trailing *line* between chunks, and cache only a drained stream | Accepted — closes the chunk-boundary and poisoned-cache defects; **amends 0006** |
| [0019](0019-in-flight-fetch-registry.md) | De-duplicate concurrent downloads of one url, but only when the cache is on | Accepted — closes the duplicate-fetch defect; **the cache entry is the handover**, so with the cache off both callers still fetch |
| [0020](0020-the-matching-line.md) | Return the first matching line, opt-in per search | Accepted — **the first widening of the public API**; **amends 0003**, and names the match details still refused — amended by 0022 (`captureLine` renamed, one refusal reopened) |
| [0021](0021-release-please.md) | release-please cuts releases; merging its PR is the trigger | Accepted — replaces tag-push publishing and push-to-main deploys; **amends 0017** (the demo now deploys on release, not on every push to `main`) |
| [0022](0022-capture-ranges.md) | Return each match's position within the captured line | Accepted — **amends 0020**: `capture: 'line' \| 'line-ranges'` replaces `captureLine`, and the "highlight ranges" refusal is reopened because **a JS re-match cannot reproduce the engine**; file-wide positions stay refused |

## Format

Each record: **Context** (the forces), **Decision** (what was chosen), **Consequences** (what it costs), and
where relevant **Current assessment** / **Outcome** / **Amendment** (what has changed since). Keep them short.

Adding one: next free number, update this table, link it from
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) if it explains something structural.
