# Decision records

One file per architectural decision, explaining **why** netgrep is shaped the way it is.

These are reconstructed from the code, git history and the public README as of 2026-07-28. Where the original
rationale was not recorded anywhere, the record says so explicitly rather than inventing one — treat those
sections as inference, not testimony.

| # | Decision | Status |
|---|---|---|
| [0001](0001-fork-ripgrep-for-wasm.md) | Depend on a fork of ripgrep to reach `wasm32` | Accepted — **and now avoidable**, see record |
| [0002](0002-search-while-downloading.md) | Search each HTTP chunk as it arrives | Accepted — the project's defining property |
| [0003](0003-boolean-only-results.md) | Return a boolean, not match details | Accepted |
| [0004](0004-two-package-split.md) | Ship two npm packages, not one | Accepted |
| [0005](0005-esm-only-distribution.md) | ESM only; a bundler is required | Accepted — main adoption barrier |
| [0006](0006-in-memory-cache.md) | Cache downloaded bytes in memory, on by default | Accepted — **has known defects** |
| [0007](0007-nx-cargo-hybrid-monorepo.md) | Nx orchestrating both JS and Cargo | Accepted |
| [0008](0008-wee-alloc.md) | `wee_alloc` as the WASM global allocator | Accepted — **dependency now unmaintained** |

## Format

Each record: **Context** (the forces), **Decision** (what was chosen), **Consequences** (what it costs),
and where relevant **Current assessment** (what has changed since). Keep them short.

Adding one: next free number, update this table, link it from
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) if it explains something structural.
