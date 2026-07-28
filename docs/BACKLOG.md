# Maintenance backlog

**Project status: maintenance only.** This list is scoped to keeping netgrep buildable, releasable and
correct. It deliberately contains **no feature work** — no new APIs, no match details, no Node.js support.
If you think something here needs a new feature to fix, stop and ask rather than expanding scope.

Every item below was verified against the repository on **2026-07-28** (macOS arm64, Node 18.7.0,
Rust 1.81.0). Anything not verified is labelled as such.

Rules that apply to all of it: dependency changes are never a side effect of other work, and releases are
human-triggered only. See [`../AGENTS.md` §6](../AGENTS.md#6-hard-rules).

---

## P0 — Broken right now

### 1. CI cannot build the Rust package

`.github/workflows/{test-and-lint,publish-search}.yml` install `toolchain: stable`, and `rust-toolchain.toml`
also says `channel = "stable"`. Current stable fails:

```
error: older versions of the `wasm-bindgen` crate are incompatible with current versions of Rust;
       please update to `wasm-bindgen` v0.2.88
```

Rust 1.82 changed the wasm C ABI; `wasm-bindgen 0.2.82` predates it. **Every push touching Rust fails today.**

*Stopgap applied.* `rust-toolchain.toml` and both Rust workflows are now pinned to `1.81.0`, so the build is
reproducible instead of drifting with whatever `stable` happens to be. This does not remove the constraint —
`wasm-bindgen 0.2.82` still caps the toolchain at 1.81. The real fix is item 4, which lifts both together and
moves the pin forward.

### 2. `nx test search` fails on a fresh machine

`wasm-pack test --chrome --headless` downloads the *latest* ChromeDriver, which cannot drive an older
installed Chrome. Observed: ChromeDriver 151 vs Chrome 150 → `invalid session id`, driver killed (signal 9).
With a version-matched driver the suite passes (2 tests).

*Fix:* document/pin `CHROMEDRIVER` in the target or CI, sourced from
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/). Currently only documented, in
[`../AGENTS.md` §4](../AGENTS.md#4-commands).

---

## P1 — Correctness

Full analysis in [`ARCHITECTURE.md`](ARCHITECTURE.md#known-limitations--correctness-caveats).
**Items 3a and 3b interact — do not fix either in isolation.**

### 3a. Chunk-boundary false negatives — `packages/netgrep/src/lib/Netgrep.ts:71`

Each `fetch` chunk is searched independently, so a pattern spanning two chunks is never matched. Silent wrong
answer, non-deterministic. Needs a retained tail buffer prepended to the next chunk; the buffer size is a
design question, since the maximum match length of an arbitrary regex is not derivable from the pattern.

### 3b. Poisoned partial cache — `Netgrep.ts:76`, `:80`, `:89-91`

Resolving on first match leaves the cache holding only a prefix of the file, unmarked as incomplete. A later
search for a different pattern reads that prefix and returns `false` for text never downloaded. Needs a
completeness flag per entry: partial entries may resume a download, never answer a query.

A naive fix for either one (always drain the stream) destroys the early-resolution property that is the point
of the project — see [decision 0002](decisions/0002-search-while-downloading.md).

### 3c. Panic on invalid pattern — `packages/search/src/lib.rs:17`

`.build(pattern).unwrap()` aborts the WASM instance when the pattern is not valid regex. Patterns normally
come straight from a user's search box, so a stray `(` kills the module instead of surfacing a catchable
error. Return a `Result`/`Option` across the boundary, or validate before calling.

### 3d. ~~No test exercises the real engine through the TypeScript API~~ — DONE

`Netgrep.integration.spec.ts` now drives the real WASM through the real streaming loop, mocking only `fetch`.
Every defect in this section is pinned there as a test asserting current (wrong) behaviour — when one is
fixed, the corresponding assertion must be inverted in the same PR.

### 3e. `^` anchors to the chunk, not the line — `packages/search/src/lib.rs:13-17`

`RegexMatcherBuilder` is built without `.multi_line(true)`. When `case_smart` leaves a pattern
case-sensitive — i.e. it contains any uppercase letter — the searcher takes a whole-buffer path where `^`
means "start of chunk" rather than "start of line". An all-lowercase pattern takes the line-by-line path and
behaves correctly. `$` is unaffected.

```
"a\nNeedle x\n"  ~  "^Needle"   ->  false   # wrong
"Needle x\n"     ~  "^Needle"   ->  true    # only because it is line 1
"a\nneedle x\n"  ~  "^needle"   ->  true    # lowercase, so correct
```

*Fix:* add `.multi_line(true)`. Verified 2026-07-28 against `grep @ 13.0.0-wasm`: it corrects every failing
case with no regression in the others. **One line.** Not applied yet only because the modernization is
scoped toolchain-only — see [`plans/MODERNIZATION.md`](plans/MODERNIZATION.md) decision 6.

### 3f. A single NUL byte discards the whole chunk — `packages/search/src/lib.rs:19`

`BinaryDetection::quit(b'\x00')` does not merely stop at the NUL; it abandons the entire chunk. A match is
dropped even when it occurs *before* the NUL, and even on an earlier line. Any remote file containing a stray
NUL therefore reports "no match" for content that is demonstrably present.

```
"needle here"              ~  "needle"  ->  true
"needle here\0tail"        ~  "needle"  ->  false   # match precedes the NUL
"needle here\n\0tail"      ~  "needle"  ->  false   # and is on an earlier line
```

Whether this is wrong depends on intent — quitting on binary input is a reasonable ripgrep default — but it
is currently undocumented and surprising for a tool whose entire API surface is a boolean. Consider
`BinaryDetection::none()`, or surfacing "binary, not searched" as distinct from "no match", which would be an
API change and therefore out of scope today.

---

## P2 — Dependency rot

### 4. `wasm-bindgen` 0.2.82 → current, and drop the ripgrep fork

Do these **together**; they are coupled. Current upstream `grep-matcher` needs edition 2024 (Rust ≥ 1.85),
while `wasm-bindgen 0.2.82` needs Rust ≤ 1.81 — mutually exclusive, so neither can move alone.

Verified 2026-07-28: unforked `grep-regex` + `grep-searcher` + `grep-matcher` from crates.io compile cleanly
for `wasm32-unknown-unknown`. The fork exists only to patch `grep-printer`/`ignore`/CLI-core, which netgrep
never uses — they are pulled in solely because `lib.rs` depends on the `grep` **meta-crate**. Depending on the
three sub-crates directly removes the fork dependency entirely.
See [decision 0001](decisions/0001-fork-ripgrep-for-wasm.md).

Unblocks a modern Rust toolchain and closes P0 item 1 properly.

### 5. `wee_alloc` is unmaintained

Unmaintained since 2022, with a known unfixed leak. Try removing it and measuring the binary-size delta —
modern `rustc` may have closed the gap. Measure, do not assume.
See [decision 0008](decisions/0008-wee-alloc.md).

### 6. Nx 14.5.4 / `@nrwl/*` → `@nx/*`

Predates the package rename, so this is a scope migration across every dev dependency, not a version bump.
`@nxrs/cargo@0.3.3` is a small third-party plugin installing with an unmet `@nrwl/devkit` peer dependency and
is the likeliest blocker. Pulls Node 18.7.0 forward to an LTS at the same time.

### 7. `ts-jest` 28 vs `jest` 29 mismatch

`ts-jest@28.0.7` warns on every run that jest 29 is untested with it. Works today; align the majors.

### 8. Stale CI actions

`actions/checkout@v2` and the **archived** `actions-rs/toolchain` across all three workflows. Move to
`actions/checkout@v4` and `dtolnay/rust-toolchain`.

---

## P3 — Papercuts

### 9. `@netgrep/search` version drift is unenforced

`packages/netgrep/package.json` hand-pins `"@netgrep/search": "^0.1.5"` with nothing checking it matches
`packages/search/Cargo.toml`. Releasing a core change is a manual two-step.
See [decision 0004](decisions/0004-two-package-split.md).

### 10. Root depends on its own published packages

Root `package.json` declares `@netgrep/netgrep@^0.1.3`, so `yarn install` pulls a 2022 copy of this repo's own
package into `node_modules`. This is what makes the example demo run against stale code. Documented as the
repo's headline gotcha in [`../AGENTS.md` §2](../AGENTS.md#2--read-this-before-you-edit-anything) and
**deliberately left unfixed** — fixing it means introducing yarn workspaces and touching both lockfiles.

### 11. `upsertMemoryCache` is O(n²) — `Netgrep.ts:198`

Reallocates and copies the whole accumulated buffer per chunk. Collect chunks in an array and join once.

### 12. Regex recompiled per chunk — `packages/search/src/lib.rs:13-17`

`search_bytes` builds a fresh `RegexMatcher` on every call, i.e. once per chunk per file. Would need a
compiled-matcher handle across the WASM boundary — a real interface change, so weigh it against the
maintenance-only scope.

### 13. `MemSink` does not short-circuit

`Sink::matched` returns `Ok(true)` (keep searching) when the result is only ever `count > 0`. Returning
`Ok(false)` stops at the first match within a chunk. One-line change, small win.
