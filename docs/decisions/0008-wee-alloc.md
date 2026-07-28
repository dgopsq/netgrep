# 0008 — `wee_alloc` as the WASM global allocator

**Status: SUPERSEDED (2026-07-28).** `wee_alloc` was removed; see *Outcome* at the end.

## Context

Every consumer of `@netgrep/netgrep` downloads the WASM binary before any search can run, so binary size is a
direct user-facing latency cost. Rust's default allocator contributes meaningfully to that size.

## Decision

Use `wee_alloc` — an allocator explicitly designed to trade throughput for a small code footprint — as the
global allocator:

```rust
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;
```

Paired with a size-tuned release profile in `packages/search/Cargo.toml`:

```toml
[profile.release]
lto = true
opt-level = 's'
```

## Consequences

- Smaller binary. The current build produces **~1.0 MB** `index_bg.wasm` — most of which is the regex engine
  and Unicode tables, not the allocator.
- Slower allocation than the default. Acceptable here: `search_bytes` allocates little, and the workload is
  dominated by regex compilation and scanning.

## Current assessment

**`wee_alloc` has been unmaintained since 2022** and carries a known unfixed memory-leak issue; the Rust/WASM
ecosystem has broadly moved back to the default allocator or to `talc`/`dlmalloc`. Its transitive
`cfg-if 0.1.10` and `memory_units 0.4.0` pins are similarly frozen.

For netgrep the leak risk is mild — `search_bytes` is a short, stateless call — but it remains an unmaintained
dependency in the hot path of a published package.

Removing it is a candidate maintenance task: delete the `#[global_allocator]` block and the dependency, then
measure. Modern `rustc` has closed much of the size gap, so the tradeoff may no longer favour `wee_alloc` at
all. Measure before and after rather than assuming either way. Tracked in [`../BACKLOG.md`](../BACKLOG.md).


---

## Outcome (2026-07-28)

**Removed. The measurement this record asked for was taken, and the assumption behind it no longer held.**

Against the modernized dependencies, `wee_alloc` was worth **6,839 bytes — 0.6%** of a ~1.12 MB binary.
Modern `rustc` has closed the gap that justified it in 2022, so the project was carrying an unmaintained
crate with a known unfixed leak, in a published package's hot path, for a rounding error.

A larger finding came out of the same measurement: the size-tuned release profile
(`lto`, `opt-level = 's'`) had **never been applied**. It lived in `packages/search/Cargo.toml`, and Cargo
ignores `[profile.*]` outside the workspace root — it only warns. Every release build in this project's
history was made at the default opt-level with no LTO. The profile now lives in the root `Cargo.toml`, where
it is worth 155,469 bytes, with `codegen-units = 1` and `panic = 'abort'` added for a further 76,166.
