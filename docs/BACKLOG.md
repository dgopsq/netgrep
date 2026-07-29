# Maintenance backlog

**Project status: maintained, conservative.** This list is scoped to keeping netgrep correct, buildable and
releasable. It contains **no feature work** — no new APIs, no match details, no Node.js support. If something
here seems to need a new feature, stop and ask rather than expanding scope.

Item numbers are stable and referenced from code comments and other documents. **Do not renumber.** Completed
items move to the bottom rather than disappearing.

Rules that apply to all of it: dependency changes are never a side effect of other work, and releases are
human-triggered only. See [`../AGENTS.md` §6](../AGENTS.md#6-hard-rules).

Verified against the repository on **2026-07-29** (macOS arm64, Node 24.18.0, Rust 1.97.1).

---

# Open

## P1 — Correctness

Full analysis in [`ARCHITECTURE.md`](ARCHITECTURE.md#known-limitations--correctness-caveats).

Every item below is **pinned by a test that asserts the current, wrong behaviour** — in
`Netgrep.integration.spec.ts`, and for the ones that live in the engine also in the `documented_defects`
module of `packages/search/tests/search.rs`. Read
[`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose)
and [decision 0011](decisions/0011-tests-that-assert-known-bugs.md) before touching any of them: **fixing one
means inverting its assertion in the same PR.**

> [!IMPORTANT]
> **Moving an item to _Done_ is not finished until the demo site stops warning about it.** The published
> page at <https://dgopsq.github.io/netgrep/> names the defects that affect its visitors, in the `CAVEATS`
> array of `packages/example/src/components/limitations.tsx`. Leave it alone and the site goes on warning
> the world about a bug you just fixed.
>
> **3a, 3b, 3f and 18 each have a caveat there. 3b and 18 also keep the demo's cache switched off** — fix
> both and the workaround goes too. Nothing checks this for you; CI will be green either way. See
> [`../AGENTS.md` §2.3](../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it).

**3a and 3b interact — do not fix either in isolation**, and 3b and 18 want the same per-url promise
registry.

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

### 17. `$` never matches on CRLF input — `packages/search/src/lib.rs`

The matcher is built without `.crlf(true)`, and the searcher's line terminator is `\n`, so on a
Windows-authored file the `\r` is the last character of the line and sits between the text and `$`.

```
"needle\n"     ~  "needle$"  ->  true
"needle\r\n"   ~  "needle$"  ->  false   # same text, different line endings
"needle\r\n"   ~  "needle"   ->  true    # unanchored is fine
"a\r\nneedle\r\n" ~ "^needle" -> true    # ^ is unaffected
```

Silent, and it depends on who authored the file rather than on anything the caller did — which makes it
harder to notice than 3f. `RegexMatcherBuilder::crlf(true)` is the fix, but it is a matching-semantics
change, so it wants its own tested commit.

Found on 2026-07-29 while broadening the test suite. Pinned in the `documented_defects` module of
`packages/search/tests/search.rs`.

### 18. Concurrent searches of one url double its cache entry — `packages/netgrep/src/lib/Netgrep.ts`

Nothing tracks a download already in flight. Two searches of the same url started before either resolves both
`fetch`, and both `upsertMemoryCache` what they read into the same entry.

The duplicate request is the cheap half. The expensive half is that the entry then holds bytes the file never
contained: the copies are joined with no separator, so the seam forms a line that exists nowhere.

```
file:   "needle"
cache:  "needleneedle"        after two concurrent searches
        ~ "^needleneedle$"  ->  true
```

`searchBatchWithCallback` makes this easy to hit — it starts every search eagerly with no concurrency limit,
so a corpus listing one url twice reaches it immediately.

A per-url promise registry fixes both halves: the second caller awaits the first instead of fetching. That is
the same registry a fix for 3b would want, so the two are worth doing together.

Found on 2026-07-29 while broadening the test suite. Pinned in `Netgrep.integration.spec.ts`.

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

---

# Done

Kept for the record, most recent first. Each says what was actually true, including where the original
analysis was wrong.

| # | Item | Outcome |
|---|---|---|
| 3c | Panic on invalid pattern | **Fixed.** `search_bytes` returns `Result<bool, JsError>`, so a stray `(` — or a literal newline, which the `\n` line terminator forbids — is a rejected promise carrying the regex crate's own diagnostic instead of `RuntimeError: unreachable`. The generated TypeScript signature did not change, so `Netgrep.ts` needed no edit. The engine is now split into a plain-Rust `try_search_bytes` and a two-line wasm wrapper, because `JsError` cannot be constructed on a native target and the Rust suite runs natively. Three assertions inverted. See [0016](decisions/0016-compiled-matcher-memo.md). |
| 12 | Regex recompiled per chunk | **Fixed, and it was not a papercut.** A one-entry `thread_local` cache of the last compiled pattern; compile failures cached alongside successes. Over 800 16 KB chunks: a literal 91.2ms → 2.2ms, a Unicode class 2.9s → 20.6ms. Compilation was **97–99% of the total cost**, not the P3 nuisance this entry called it. The compiled-matcher *handle* this entry recommended was considered and rejected — it puts `.free()` on four exit paths of a promise executor and breaks a package whose whole surface is one function. See [0016](decisions/0016-compiled-matcher-memo.md). |
| 13 | `MemSink` does not short-circuit | **Fixed.** `Ok(false)` stops at the first match; `match_count: u64` became `found: bool`. On chunks where every line matches, 16.4ms → 1.3ms at 16 KB and 61.9ms → 1.8ms at 64 KB; neutral on a single late match. Behaviourally unobservable — all 59 tests pass either way — so measurement is the only evidence it does anything. |
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
