# Maintenance backlog

**Project status: maintained, conservative.** This list is scoped to keeping netgrep correct, buildable and
releasable, and everything currently *open* on it is a defect or a piece of health work.

**Feature work is not planned here.** It starts as an issue, is argued there, and lands with a decision record
that also says what it does *not* open the door to — see
[`../AGENTS.md` §1](../AGENTS.md#1-what-this-project-is). A completed feature is recorded in *Done* below like
anything else, so the numbering stays a single sequence. If an item here seems to need a new feature, stop and
open an issue rather than expanding its scope.

Item numbers are stable and referenced from code comments and other documents. **Do not renumber.** Completed
items move to the bottom rather than disappearing.

Rules that apply to all of it: dependency changes are never a side effect of other work, and releases are
human-triggered only — the human act being the merge of release-please's release PR. See
[`../AGENTS.md` §6](../AGENTS.md#6-hard-rules).

**Type your commits with the release in mind.** `chore:` neither releases nor appears in a changelog, so
maintenance that changes the published bytes belongs under `fix(search):`, and a change a visitor can see on
the demo belongs under `fix(example):`. AGENTS.md §6 rules 2 and 3 explain why.

Verified against the repository on **2026-07-30** (macOS arm64, Node 24.18.0, Rust 1.97.1).

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
> page at <https://netgrep.diegopasquali.com/> names the defects that affect its visitors, and every one of
> them lives once in [`guide/caveats.data.json`](guide/caveats.data.json). Delete the entry and run
> `pnpm docs:sync`, or the site goes on warning the world about a bug you just fixed.
>
> **3f has a caveat there.** The demo's cache is switched off, but no longer for any reason on this list — a
> warm cache stops the page's timings measuring the network, which is a choice about the demo rather than a
> workaround for a defect. `pnpm docs:sync --check` keeps the three rendered surfaces honest to that file;
> what it cannot tell you is that an item here needs an entry in it at all. See
> [`../AGENTS.md` §2.3](../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it).

**3a and 3b were fixed together on 2026-07-30** — see the *Done* table and
[decision 0018](decisions/0018-line-oriented-tail-buffer.md). They had to be: 3a was suppressing early
resolution, so fixing it alone would have made 3b fire more often, in the default configuration. 3a left a
residual, recorded as **3g** below.

### 3g. Anchors and long matches are unreliable inside a line longer than 64 KB — `packages/netgrep/src/lib/Netgrep.ts`

What 3a's fix does not cover. `splitAtLastLine` retains the incomplete trailing *line* between chunks, which is
exact — a match cannot span a `\n`. But a line with no terminator in it would buffer an entire response, so
past a 64 KB ceiling the tail degrades to a plain window on the last 64 KB. Three consequences, in both
directions:

- **A match longer than 64 KB is lost**, because it starts before the retained window and ends after the buffer.
- **`^` can match where no line begins.** A windowed tail starts mid-line and the engine cannot be told so, so
  it anchors to the window's first byte. A false positive, unlike every other entry in this list.
- **A captured line is a mid-line fragment.** Added by item 19: with `capture` on, the string returned for
  a match inside an over-long line begins at whatever byte the window fell on, so it is not a line (and, with
  `capture: 'line-ranges'`, possibly an empty `ranges` — the fragment need not contain the match). `result` is
  still right. Returning `null` instead was rejected in [decision 0020](decisions/0020-the-matching-line.md) —
  it would cost every consumer a null check on a branch the type has already narrowed, to describe a case only
  minified input reaches.

Needs one line longer than 64 KB **and** a match spanning most of it, so it is unreachable in hand-written
text: the demo corpus is 2.6 MB of prose whose longest line is 76 bytes. Reachable in minified JavaScript or a
single-line data dump.

Pinned by the three `BACKLOG 3g` tests in `Netgrep.integration.spec.ts`, each with the control case that must
not regress — a match arriving complete in **one** chunk is found, because the buffer is searched whole before
the window is taken; `^` does not match when the window is never flushed on its own; and a line captured from a
single chunk starts where the line starts.

**Deliberately not on the demo site**, for the same reason as item 17: the corpus cannot trigger it. Recorded
as `demoCorpusCanTrigger: false` in [`guide/caveats.data.json`](guide/caveats.data.json) so that stays a
decision rather than an omission.

Not obviously worth fixing. Raising the ceiling trades memory for a case nobody has hit; removing it means
buffering without bound. Left recorded rather than planned.

### 3f. A single NUL byte discards the whole searched block — `packages/search/src/lib.rs`

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

Decision 0018 changed its blast radius without fixing it. The engine is handed the block of complete lines in a
chunk rather than the chunk, so how far a NUL reaches now depends on where the last `\n` falls, and a match on
an earlier line survives *if* the NUL lands in the held-back partial line. Incidental, and pinned in both
directions so it is not mistaken for a fix. **Fix it in `lib.rs` or not at all.**

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

---

## P2 — Health

### 14. The `.wasm` is ~1.17 MB, up 12.6% from the 2022 build

1,038,608 → 1,169,300 bytes. Accounted for (dependency rows measured 2026-07-28, release builds through
`wasm-pack`):

| change | bytes |
|---|---|
| 2022 baseline (fork, `wasm-bindgen` 0.2.82, `wee_alloc`, inert profile) | 1,038,608 |
| modernized dependencies | **+341,949** |
| removing `wee_alloc` | +6,839 |
| moving `[profile.release]` to the workspace root | −155,469 |
| `codegen-units = 1`, `panic = 'abort'` | −76,166 |
| `search_bytes_line` and its line post-processing (item 19, 2026-07-30) | +15,769 |
| `search_bytes_line_ranges` and the UTF-16 offset pass (item 19's follow-up, 2026-08-01) | +4,609 |
| **net** | **+130,692** |

The bulk is upstream — newer `regex-automata` carries larger DFA and Unicode tables — and is not really
reducible without giving up the modern crates. Roughly 502 KB gzipped over the wire.

The demo's `StatsBar` states this number to visitors, so it moves when this does — see
[`../AGENTS.md` §2.3](../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it).

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

### 19. The cache has no eviction, size cap or TTL — `packages/netgrep/src/lib/Netgrep.ts`

It retains the full bytes of every file searched for the lifetime of the `Netgrep` instance. A long-lived page
searching a large corpus grows monotonically.

This is what remained of item **11** after [decision 0018](decisions/0018-line-oriented-tail-buffer.md) fixed
its O(n²) half; renumbered rather than reopened, because item numbers are stable and 11 is now in *Done*.

### 20. `NPM_TOKEN` is a long-lived credential — `.github/workflows/publish-*.yml`

Both publishes authenticate with a maintainer token stored as a repository secret, which does not expire
until someone rotates it. npm's **trusted publishing** replaces it with a short-lived OIDC token minted per
run, leaving no credential in the repository at all.

Deliberately deferred rather than done alongside release-please: the first release-please run was already the
largest release this repository has ever cut, and stacking a second new authentication mechanism onto it
would have made a failure ambiguous between the two. `provenance: true` shipped in the meantime, so the
tarballs already carry an attestation naming the workflow and commit that built them — this item is only
about removing the token.

Two things to establish before starting, neither of which is answerable from the docs: whether npm matches
the trusted publisher on the `workflow_ref` (top-level) or `job_workflow_ref` (reusable file) claim, and
whether the publish action performs the OIDC exchange at all. The answer to the first decides whether
`release.yml` or `publish-*.yml` is the registered publisher — and since only one can be, **it will break the
`workflow_dispatch` retry path for npm**, which exists precisely because a failed publish cannot be retried
by re-running `release.yml`.

---

# Done

Kept for the record, most recent first. Each says what was actually true, including where the original
analysis was wrong.

| # | Item | Outcome |
|---|---|---|
| 19 | Return the matching line alongside the boolean | **Shipped, and only because 3a landed first.** [Issue #19](https://github.com/dgopsq/netgrep/issues/19) proposed it against a `MemSink` that no longer existed — item 13 had already made it short-circuit, so the "closes 13 for free" argument was void and the sketch's ~10 lines were a diff already applied. What made it worth doing instead was [0018](decisions/0018-line-oriented-tail-buffer.md): before it, each chunk was searched alone, so a first occurrence straddling a seam was missed and the line returned was silently the file's *second* match, varying with how the network split the response. With whole lines delivered in order, the line is the file's first matching line under any chunking — pinned across six chunk sizes — and the warm cache agrees with a cold fetch. Opt-in via a flag — `captureLine` then, `capture: 'line'` since 0022 — and a **second** WASM export so `search_bytes` is untouched and the boolean path allocates nothing, capped in Rust before the copy (`maxLineBytes`, default 4096), terminator stripped, decoded lossily. The flag's effect is in the type: no `line` key at all when off, and `result` is a discriminant when on. Left a residual in **3g** — inside an over-long line the "line" is a fragment. `.wasm` +15,769 bytes. 16 Rust tests, 20 TypeScript. See [0020](decisions/0020-the-matching-line.md), which also names the match details refused alongside it. Each match's position *within* that line shipped a day later as `capture: 'line-ranges'`, a third export on the same pattern — [0022](decisions/0022-capture-ranges.md), which reopened 0020's refusal of highlight ranges because its stated reason (re-run the pattern in JS) cannot reproduce smart case. |
| 18 | Concurrent searches of one url both fetch | **Fixed, for cache-on instances only — and that is the whole design rather than a shortcut.** A per-url registry of in-flight searches; a second caller of the same url waits on the first and answers from the entry it writes. The entry *is* the handover, so with the cache **off** there is nothing to hand over: sharing would mean either retaining every chunk of a file nobody asked to keep — the cost [0018](decisions/0018-line-oriented-tail-buffer.md) had just removed — or teeing the response stream and with it the first caller's abort signal. So with the cache off both callers still fetch, deliberately, and a test pins it. Two more residuals, both pinned: a first caller that matches early resolves without draining, writes no entry, and its waiter fetches after all — one saved request is the common case, not a guarantee; and a failed download is not inherited by its waiter, which retries with its own signal. `searchBatch` and `searchBatchWithCallback` inherit the de-duplication for free, since both go through `search`. The demo is untouched: it runs with the cache off on purpose, because the page measures the network. See [0019](decisions/0019-in-flight-fetch-registry.md). |
| 3a | Chunk-boundary false negatives | **Fixed, and the design question in [issue #20](https://github.com/dgopsq/netgrep/issues/20) had a wrong premise.** That issue said the tail size must be a configured cap because the maximum match length of an arbitrary regex is not derivable from the pattern. True — but it is derivable from the *data*: a match can never span a `\n`, because grep-regex strips the terminator out of character classes and rejects patterns containing a literal one. So the exact carry-over is the incomplete trailing **line**, and no cap is needed for correctness. `MAX_TAIL_BYTES` (64 KB, not configurable) exists only so a line with no terminator cannot buffer a 500 MB response; past it the tail degrades to a byte window, which is item **3g**. Fixing it also removed the never-tracked mirror-image false *positives*, where a seam looked like a line start to `^` and a line end to `$`. Early resolution became line-granular, which costs two extra reads in one test and nothing against real 16–64 KB chunks. Four assertions inverted. See [0018](decisions/0018-line-oriented-tail-buffer.md). |
| 3b | Poisoned partial cache | **Fixed, and it had to ship with 3a.** Not for the reason recorded here — "a naive fix drains the stream" is a shared failure mode of bad fixes, not a coupling. The real one: 3a was *suppressing* early resolution, so closing it alone would have left more searches resolving early, more prefixes cached, and a regression in the default configuration. The fix is smaller than the completeness flag this entry proposed: write the entry only when the reader reports `done`, so a partial one is never created. A partial entry cannot resume a download either, and nothing needed it to. Note a match in the *final* chunk still caches nothing — `done` is one read later. |
| 11 | `upsertMemoryCache` is O(n²) | **Fixed** as a side effect of 3b, because "collect chunks and join once" is what deferring the write requires. Chunks are also only collected when the cache is *on*, so a search with it off no longer retains the whole file — it had been paying the memory cost for a cache it was not using. The no-eviction half of this entry is not fixed and is now item **19**. |
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
