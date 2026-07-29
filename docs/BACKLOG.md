# Maintenance backlog

**Project status: maintained, conservative.** This list is scoped to keeping netgrep correct, buildable and
releasable. It contains **no feature work** — no new APIs, no match details, no Node.js support. If something
here seems to need a new feature, stop and ask rather than expanding scope.

Item numbers are stable and referenced from code comments and other documents. **Do not renumber.** Completed
items move to the bottom rather than disappearing.

Rules that apply to all of it: dependency changes are never a side effect of other work, and releases are
human-triggered only. See [`../AGENTS.md` §6](../AGENTS.md#6-hard-rules).

Verified against the repository on **2026-07-28** (macOS arm64, Node 24.18.0, Rust 1.97.1).

---

# Open

## P1 — Correctness

Full analysis in [`ARCHITECTURE.md`](ARCHITECTURE.md#known-limitations--correctness-caveats).

Every item below is **pinned by a test** in `Netgrep.integration.spec.ts` that asserts the current, wrong
behaviour. Read [`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose)
and [decision 0011](decisions/0011-tests-that-assert-known-bugs.md) before touching any of them: **fixing one
means inverting its assertion in the same PR.**

**3a and 3b interact — do not fix either in isolation.**

### 3a. Chunk-boundary false negatives — `packages/netgrep/src/lib/Netgrep.ts`

Each `fetch` chunk is searched independently, so a pattern spanning two chunks is never matched. Silent wrong
answer, non-deterministic because it depends on network chunking.

Needs a retained tail buffer prepended to the next chunk. The buffer size is the design question: the maximum
match length of an arbitrary regex is not derivable from the pattern, so it has to be a configured cap.

### 3b. Poisoned partial cache — `packages/netgrep/src/lib/Netgrep.ts`

Resolving on first match leaves the cache holding only a prefix of the file, unmarked as incomplete. A later
search for a different pattern reads that prefix and returns `false` for text never downloaded.

Needs a completeness flag per entry: partial entries may resume a download, never answer a query.

A naive fix for either 3a or 3b — always draining the stream — destroys the early-resolution property that is
the entire point of the project. See [decision 0002](decisions/0002-search-while-downloading.md).

### 3c. Panic on invalid pattern — `packages/search/src/lib.rs`

`.build(pattern).unwrap()` traps the WASM instance when the pattern is not valid regex. Patterns normally
come straight from a user's search box, so a stray `(` surfaces as `RuntimeError: unreachable` instead of a
catchable domain error. The instance does remain usable afterwards.

Return a `Result`/`Option` across the boundary, or validate before calling.

### 3f. A single NUL byte discards the whole chunk — `packages/search/src/lib.rs`

`BinaryDetection::quit(b'\x00')` does not merely stop at the NUL; it abandons the entire chunk. A match is
dropped even when it occurs *before* the NUL, and even on an earlier line.

```
"needle here"              ~  "needle"  ->  true
"needle here\0tail"        ~  "needle"  ->  false   # match precedes the NUL
"needle here\n\0tail"      ~  "needle"  ->  false   # and is on an earlier line
```

Quitting on binary input is a reasonable ripgrep default; the surprise is that a boolean API cannot
distinguish "binary, not searched" from "no match". Options: `BinaryDetection::none()`, or surfacing the
distinction — which is an API change and therefore out of scope today.

---

## P2 — Health

### 14. The `.wasm` is ~1.15 MB, up 10.6% from the 2022 build

1,038,608 → 1,148,922 bytes. Accounted for (all measured 2026-07-28, release builds through `wasm-pack`):

| change | bytes |
|---|---|
| 2022 baseline (fork, `wasm-bindgen` 0.2.82, `wee_alloc`, inert profile) | 1,038,608 |
| modernized dependencies | **+341,949** |
| removing `wee_alloc` | +6,839 |
| moving `[profile.release]` to the workspace root | −155,469 |
| `codegen-units = 1`, `panic = 'abort'` | −76,166 |
| **net** | **+110,314** |

The bulk is upstream — newer `regex-automata` carries larger DFA and Unicode tables — and is not really
reducible without giving up the modern crates. Roughly 480 KB gzipped over the wire.

Remaining levers, none taken: `opt-level = 'z'` (a further ~27 KB, at some throughput cost in a
regex-scanning hot path); `wasm-opt -Oz`; disabling `grep-regex`'s Unicode support, which would change
matching behaviour and is out of scope.

### 15. `memmap2` is compiled into a browser binary

`grep-searcher` depends on `memmap2` **unconditionally** — it is not feature-gated, and the crate's only
features are deprecated no-ops, so `default-features = false` drops nothing. netgrep only ever calls
`search_slice`, never the mmap reader, so it is dead weight.

Removing it means patching `grep-searcher`, i.e. reintroducing the fork that was deleted in
[decision 0001](decisions/0001-fork-ripgrep-for-wasm.md). Not worth it. Recorded so it is not rediscovered.

---

## P3 — Papercuts

### 11. `upsertMemoryCache` is O(n²)

Reallocates and copies the whole accumulated buffer per chunk. Collect chunks in an array and join once. The
cache also has no eviction, size cap or TTL — it retains every file searched for the lifetime of the instance.

### 12. Regex recompiled per chunk — `packages/search/src/lib.rs`

`search_bytes` builds a fresh `RegexMatcher` on every call, i.e. once per chunk per file, discarding the most
expensive part of the work each time. Fixing it needs a compiled-matcher handle across the WASM boundary — a
real interface change, so weigh it against the conservative scope.

### 13. `MemSink` does not short-circuit

`Sink::matched` returns `Ok(true)` (keep searching) when the result is only ever `count > 0`. Returning
`Ok(false)` stops at the first match within a chunk. One line, small win.

---

# Done

Kept for the record, most recent first. Each says what was actually true, including where the original
analysis was wrong.

| # | Item | Outcome |
|---|---|---|
| 2 | `pnpm test:wasm` fails on a fresh machine | **Fixed by removing the harness.** ChromeDriver was versioned independently of the browser it drove, by a mechanism this repo did not control, so the mismatch was structural. Playwright now runs the browser tests with a Chromium pinned to its own package version, the Rust tests became a native `cargo test` (`pnpm test:rust`), and browser coverage went *up* — 2 assertions about pure byte logic replaced by the 17-test integration suite, which now also exercises the fetch-based loader. See [0013](decisions/0013-playwright-for-browser-tests.md). |
| 16 | Published package did not work under Vite | **Fixed.** Shipped wasm-pack's `web` target; the `bundler` target failed *silently* under Vite, returning `false` for every search. Verified in real Chrome against Vite (no plugins), webpack (no config), and a fresh app installed from the actual tarballs. See [0005](decisions/0005-esm-only-distribution.md). |
| 10 | Root depended on its own published packages | **Fixed** by pnpm workspaces. The example now bundles local source. This was the repository's headline gotcha. See [0009](decisions/0009-pnpm-workspaces.md). |
| 9 | `@netgrep/search` version drift unenforced | **Fixed.** `workspace:*` plus `post_build.js` copying the version from `Cargo.toml`; `verify:pack` asserts it. |
| 8 | Stale CI actions | **Fixed.** `actions/checkout@v4`, `actions/setup-node@v4`, archived `actions-rs/toolchain` → `dtolnay/rust-toolchain`, plus `Swatinem/rust-cache` and a pinned wasm-pack action. |
| 7 | `ts-jest` 28 vs `jest` 29 mismatch | **Moot.** Both removed; replaced by Vitest. See [0010](decisions/0010-vitest-and-biome.md). |
| 6 | Nx 14.5.4 / `@nrwl/*` → `@nx/*` | **Removed, not migrated**, along with `@nxrs/cargo` — nine packages. See [0007](decisions/0007-nx-cargo-hybrid-monorepo.md) and [0009](decisions/0009-pnpm-workspaces.md). |
| 5 | `wee_alloc` unmaintained | **Removed, and the assumption was wrong.** Measured at 6,839 bytes — 0.6%. Modern `rustc` closed the gap. Same measurement revealed `[profile.release]` had never been applied at all. See [0008](decisions/0008-wee-alloc.md). |
| 4 | `wasm-bindgen` 0.2.82 → current, drop the ripgrep fork | **Done together**, 0.2.126 + the three `grep-*` sub-crates from crates.io, Rust 1.97.1. The "mutually exclusive" constraint recorded here was an artifact of the old pins. `lib.rs` changed by two import lines; `Cargo.lock` lost 21 crates. See [0001](decisions/0001-fork-ripgrep-for-wasm.md). |
| 3e | `^` anchored to the chunk, not the line | **Fixed upstream, for free**, by item 4 — no `lib.rs` change needed. Caught only by the defect-pinning test; see [0011](decisions/0011-tests-that-assert-known-bugs.md). |
| 3d | No test exercised the real engine through the TypeScript API | **Fixed.** `Netgrep.integration.spec.ts` drives the real WASM through the real streaming loop, loading the artefact that actually ships. |
| 1 | CI could not build the Rust package | **Fixed.** `rust-toolchain.toml` said `channel = "stable"`, so Rust 1.82's wasm C ABI change broke every push touching Rust. Pinned — a version move is now a reviewable commit rather than something that happens to you. |
