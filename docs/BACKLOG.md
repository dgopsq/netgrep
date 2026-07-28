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

### 1. ~~CI cannot build the Rust package~~ — DONE

`rust-toolchain.toml` said `channel = "stable"`, so Rust 1.82's wasm C ABI change broke every push touching
Rust. Pinned to 1.81.0 as a stopgap, then to **1.97.1** once `wasm-bindgen` moved (item 4). The pin is the
permanent fix: a version move is now a deliberate commit rather than something that happens to you.

### 2. `pnpm test:wasm` fails on a fresh machine

`wasm-pack test --chrome --headless` downloads the *latest* ChromeDriver, which cannot drive an older
installed Chrome. Observed: ChromeDriver 151 vs Chrome 150 → `invalid session id`, driver killed (signal 9).
With a version-matched driver the suite passes (2 tests).

*Fix:* pin `CHROMEDRIVER` locally, sourced from
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/). **This is a local-machine
problem only** — it happens when the installed Chrome is *older* than the driver wasm-pack fetches.

Do **not** try to pin it in CI. That was attempted with `browser-actions/setup-chrome` and reverted: the
action installs a driver into the tool cache, but the browser ChromeDriver actually launches is the runner's
*system* Chrome, so pinning one half of the pair creates the very mismatch it was meant to prevent
(ChromeDriver 151 against the system browser -> SIGKILL). Letting wasm-pack manage the driver keeps both
halves current together.

Note `wasm-pack` **overrides** `CHROMEDRIVER` with its own cached copy, so exporting it and running
`wasm-pack test` does nothing. The harness has to be invoked directly:

```bash
cd packages/search
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=~/Library/Caches/.wasm-pack/wasm-bindgen-<hash>/wasm-bindgen-test-runner
export CHROMEDRIVER=/path/to/matching/chromedriver
export WASM_BINDGEN_TEST_ONLY_WEB=1
cargo test --target wasm32-unknown-unknown
```

The runner must match the `wasm-bindgen` version in `Cargo.toml`; a stale cached one fails with
`panicked at 'remaining data [...]', crates/cli-support/src/descriptor.rs`. Running `wasm-pack test` once
downloads the right one into the cache.

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

### 3e. ~~`^` anchors to the chunk, not the line~~ — FIXED UPSTREAM

`^` used to mean "start of chunk" rather than "start of line" whenever `case_smart` left a pattern
case-sensitive, so `^Needle` matched only on line 1 while `^needle` worked everywhere.

**Fixed by item 4**, at no cost: moving from the forked `grep` 13.0.0 to `grep-regex 0.1.14` /
`grep-searcher 0.1.17` corrects every case, with no change to `lib.rs`. The planned `.multi_line(true)` fix
turned out to be unnecessary.

The behaviour change was detected by the integration test, which asserted the old wrong answer — exactly the
scenario the baseline exists for. Its assertion was inverted in the same PR.

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

### 4. ~~`wasm-bindgen` 0.2.82 → current, and drop the ripgrep fork~~ — DONE

`wasm-bindgen` 0.2.82 → 0.2.126, and `grep` (forked, 13.0.0-wasm) → `grep-matcher 0.1.9` +
`grep-regex 0.1.14` + `grep-searcher 0.1.17` from crates.io. Rust pin moved 1.81.0 → 1.97.1.

The "mutually exclusive" framing recorded here was wrong — an artifact of the old pins. Both sides move
together cleanly. The fork's patches only ever applied to `grep-printer`, `ignore` and the CLI core, which
arrived solely via the `grep` meta-crate and are now never compiled, so the problem the fork solved stopped
existing rather than being solved differently. `lib.rs` changed by two import lines.

Fixed 3e for free. See [decision 0001](decisions/0001-fork-ripgrep-for-wasm.md).

### 5. ~~`wee_alloc` is unmaintained~~ — DONE, and the assumption was wrong

Removed. Measured rather than assumed, as this item asked: against the modernized dependencies `wee_alloc`
saves **6,839 bytes — 0.6%**. Modern `rustc` has indeed closed the gap, so an unmaintained dependency with a
known leak was being carried in a published package's hot path for nothing.

See [decision 0008](decisions/0008-wee-alloc.md) and item 14 for the size accounting.

### 6. ~~Nx 14.5.4 / `@nrwl/*` → `@nx/*`~~ — DONE

Nx removed entirely rather than migrated, along with `@nxrs/cargo`. Replaced by pnpm workspaces and npm
scripts. Node 18.7.0 → 24.18.0 LTS at the same time.

### 7. ~~`ts-jest` 28 vs `jest` 29 mismatch~~ — DONE

Moot: jest and ts-jest are gone, replaced by Vitest.

### 8. Stale CI actions

`actions/checkout@v2` and the **archived** `actions-rs/toolchain` across all three workflows. Move to
`actions/checkout@v4` and `dtolnay/rust-toolchain`.

---

## P3 — Papercuts

### 9. ~~`@netgrep/search` version drift is unenforced~~ — DONE

`packages/netgrep` now uses `workspace:*`, and `scripts/post_build.js` copies the version out of `Cargo.toml`
into `packages/search/package.json` on every build, so the two cannot disagree.

### 10. ~~Root depends on its own published packages~~ — DONE

pnpm workspaces link `@netgrep/netgrep` and `@netgrep/search` locally, and root no longer declares its own
published package. The example bundles `../search/pkg` and `../netgrep/dist`. This was the repository's
headline gotcha.

### 11. `upsertMemoryCache` is O(n²) — `Netgrep.ts:198`

Reallocates and copies the whole accumulated buffer per chunk. Collect chunks in an array and join once.

### 12. Regex recompiled per chunk — `packages/search/src/lib.rs:13-17`

`search_bytes` builds a fresh `RegexMatcher` on every call, i.e. once per chunk per file. Would need a
compiled-matcher handle across the WASM boundary — a real interface change, so weigh it against the
maintenance-only scope.

### 13. `MemSink` does not short-circuit

`Sink::matched` returns `Ok(true)` (keep searching) when the result is only ever `count > 0`. Returning
`Ok(false)` stops at the first match within a chunk. One-line change, small win.

### 14. The `.wasm` grew 10.6% in the dependency modernization

1,038,608 → 1,148,922 bytes. Accounted for as follows (all measured 2026-07-28, release builds through
`wasm-pack`):

| change | bytes | note |
|---|---|---|
| baseline (fork, `wasm-bindgen` 0.2.82, `wee_alloc`) | 1,038,608 | `[profile.release]` was silently inert |
| modernized dependencies | **+341,949** | newer `regex-automata` — larger DFA and Unicode tables |
| removing `wee_alloc` | +6,839 | see item 5 |
| moving `[profile.release]` to the workspace root | −155,469 | `lto` + `opt-level='s'` finally applied |
| `codegen-units = 1`, `panic = 'abort'` | −76,166 | `panic='abort'` verified behaviour-neutral |
| **net** | **+110,314** | |

The bulk is upstream and not really reducible without giving up the modern crates. Remaining levers, none
taken: `opt-level = 'z'` (a further ~27 KB, at some throughput cost in a regex-scanning hot path);
`wasm-opt -Oz`; and disabling `grep-regex`'s Unicode support, which would change matching behaviour and is
therefore out of scope.

### 16. ~~The published package does not work under Vite~~ — FIXED

`@netgrep/search` shipped wasm-pack's **bundler** target, whose entry does
`import * as wasm from './index_bg.wasm'`. webpack supported that behind `experiments.asyncWebAssembly`;
Vite did not, and failed **silently** — `vite build` emitted the `.wasm`, kept the glue, never assigned the
exports object, and every search returned `false` with no error. `searchBatch` folds per-URL failures into
`{result: false}`, so a completely broken build was indistinguishable from "no matches".

**Fixed by shipping `--target web` instead** (`@netgrep/search` 0.2.0). The binary is now loaded through a
standard `new URL('index_bg.wasm', import.meta.url)`, which every current bundler understands.

Verified 2026-07-28, each in real headless Chrome:

| consumer | before | after |
|---|---|---|
| Vite 8, no plugins | silently returned `false` for everything | correct results |
| webpack 5 | required `experiments.asyncWebAssembly` | works with **no config at all** |
| Rollup / esbuild / Parcel / Bun | unsupported | standard `new URL` semantics |

Costs, for the record: `init()` must be awaited before `search_bytes`, which is a breaking change to
`@netgrep/search` — absorbed inside `Netgrep`, so `@netgrep/netgrep`'s public API is untouched. The glue grew
3,136 bytes; the `.wasm` is byte-identical.

Dropping the bundler target also removed the need for a separate `--target nodejs` build: the integration
tests now load the artefact that actually ships.

### 15. `memmap2` is compiled into a browser binary

`grep-searcher 0.1.17` depends on `memmap2` unconditionally — it is not feature-gated, and the crate's only
features are deprecated no-ops, so `default-features = false` drops nothing. netgrep only ever calls
`search_slice`, never the mmap reader, so this is dead weight. Removing it means patching `grep-searcher`,
i.e. reintroducing the fork that was just deleted — not worth it. Recorded so the next person does not
rediscover it.
