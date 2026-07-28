# 0001 — Depend on a fork of ripgrep to reach `wasm32`

**Status: SUPERSEDED (2026-07-28).** The fork was dropped; see *Outcome* at the end.

## Context

netgrep needs ripgrep's matching engine compiled to `wasm32-unknown-unknown`. Upstream ripgrep 13.0.0 does not
build for that target: several crates use `std::time::{Instant, SystemTime, Duration}`, and on
`wasm32-unknown-unknown` there is no clock syscall — `Instant::now()` panics at runtime and the target lacks
the platform support `std::time` assumes.

## Decision

Maintain a fork, [`dgopsq/ripgrep`](https://github.com/dgopsq/ripgrep), and consume it as a Cargo git
dependency pinned to tag **`13.0.0-wasm`** (commit `c14c72c4`):

```toml
grep = { git = "https://github.com/dgopsq/ripgrep", tag = "13.0.0-wasm" }
```

## What the fork actually changes

The README describes it only as "just enough changes to make it runnable on WASM". The real diff against
upstream `13.0.0` is **16 files** and one conceptual change, verified by diffing the two tags:

**Replace `std::time` with the [`instant`](https://crates.io/crates/instant) crate v0.1.12, with its
`wasm-bindgen` feature enabled.** `instant` is a drop-in `std::time` replacement that on wasm targets is backed
by the browser's `performance.now()` and elsewhere delegates straight to `std::time`.

Added as a dependency in three manifests — root `Cargo.toml`, `crates/ignore/Cargo.toml`,
`crates/printer/Cargo.toml` — and the import swapped in:

- `crates/core/{args,main,search}.rs`
- `crates/ignore/src/walk.rs`
- `crates/printer/src/{json,standard,stats,summary,util}.rs`
- `tests/{json,util}.rs`

Plus one small addition in `crates/cli/src/lib.rs` — a stub for non-unix, non-windows targets:

```rust
#[cfg(not(any(unix, windows)))]
fn imp() -> bool { false }
```

**Nothing was removed.** There is no mmap surgery, no filesystem stubbing, no feature gutting. The patch is
far smaller than the README implies.

## Consequences

- The Rust build depends on a personal GitHub fork being reachable and its tag never moving. If that repo
  disappears, netgrep cannot build.
- Upstream ripgrep fixes and performance work do not flow in. The fork's last push was February 2023;
  ripgrep is now at 14.x.
- Anyone wanting to change the engine must work across two repositories, cut a new tag, and bump
  `packages/search/Cargo.toml`. There is no vendored copy in this repo to patch.
- The fork transitively pins `instant` 0.1.12, itself now deprecated in favour of `web-time`.

## Current assessment

**The fork is not needed for what netgrep actually uses.** Verified 2026-07-28:

`src/lib.rs` imports only `grep::regex::RegexMatcherBuilder` and `grep::searcher::{…}` — that is
`grep-regex`, `grep-searcher` and `grep-matcher`. **None of those three use `std::time`.** The crates the fork
patches are `grep-printer`, `ignore` and the ripgrep CLI core — and netgrep uses none of them. They are pulled
in only because `lib.rs` depends on the **`grep` meta-crate**, which re-exports the printer.

Confirmed empirically: a scratch crate depending on unforked `grep-regex = "=0.1.9"`,
`grep-searcher = "=0.1.8"` and `grep-matcher = "=0.1.5"` from crates.io compiles cleanly for
`wasm32-unknown-unknown`.

So depending on the three sub-crates directly instead of the `grep` meta-crate would drop the fork entirely.

**However** — this cannot be done in isolation. Current upstream `grep-matcher` requires edition 2024
(Rust ≥ 1.85), while `wasm-bindgen 0.2.82` requires Rust ≤ 1.81. Those constraints are mutually exclusive, so
dropping the fork and upgrading `wasm-bindgen` must be a single coordinated change.

Tracked in [`../BACKLOG.md`](../BACKLOG.md).


---

## Outcome (2026-07-28)

**The fork is gone, and it did not need replacing — the problem it solved stopped existing.**

`lib.rs` only ever used `grep-regex`, `grep-searcher` and `grep-matcher`. The patched crates
(`grep-printer`, `ignore`, CLI core) arrived *solely* because `Cargo.toml` depended on the `grep`
**meta-crate**. Depending on the three sub-crates directly means they are never compiled, so their
`std::time` usage — the entire substance of the fork — never reaches the wasm target.

`packages/search/src/lib.rs` changed by two import lines. `Cargo.lock` lost 21 crates, including
`grep`, `grep-cli`, `grep-printer`, `globset`, `instant`, `termcolor`, `atty`, `bytecount` and `base64`.

This record also claimed the upgrade was blocked: current `grep-matcher` needs edition 2024 (Rust ≥ 1.85)
while `wasm-bindgen 0.2.82` needed Rust ≤ 1.81, "mutually exclusive". That was an artifact of the old pins.
Both sides move together cleanly.

**It fixed a bug for free.** `^` had been anchoring to the start of the *chunk* rather than the line whenever
`case_smart` left a pattern case-sensitive. The newer crates correct it; no change to `lib.rs` was needed.

`github.com/dgopsq/ripgrep` is now unreferenced. Archiving it is the maintainer's call.
