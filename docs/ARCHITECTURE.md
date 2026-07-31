# Architecture

How netgrep is built and why it behaves the way it does. For *decisions* and their rationale see
[`decisions/`](decisions/). For how to work in the repo see [`../AGENTS.md`](../AGENTS.md).

---

## Scope

netgrep answers one question: **does `pattern` occur in the file at `url`?** The answer is a `boolean`, and —
if the caller passes `captureLine` — the **first matching line**. No line numbers, no byte offsets, no match
counts, no ranking; [decision 0020](decisions/0020-the-matching-line.md) records why the line was the only one
of these worth adding, and why the rest stay refused.

The distinguishing property is *when* it answers: the search runs against each chunk of the HTTP response
**as it arrives**, so a match in the first kilobyte resolves without waiting for the remaining megabytes.

It is a browser-targeted library. It requires `fetch` with a readable response body stream. It needs **no
bundler configuration**: since 0.2.0 the WASM is loaded through a standard
`new URL('index_bg.wasm', import.meta.url)`, which Vite, webpack 5, Rollup, esbuild, Parcel and Bun all
understand out of the box.

**Non-goals:** indexing, ranking, highlighting, match positions, Node.js support, filesystem search, a CLI.

**It is an experiment rather than a recommended way to build search**, and the public README leads with that.
A prebuilt index will usually beat it on size, speed and capability; what netgrep tests is whether ripgrep's
real engine is usable over HTTP against files as they download. That framing is why the correctness caveats
below are documented rather than hidden, and why the API has widened exactly once, deliberately, in four
years.

---

## The three packages

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/example  — the public demo, deployed to GitHub Pages     │
│   Vite + React + Tailwind, 56 .txt files, debounced input →      │
│   searchBatchWithCallback, memory cache OFF (decision 0017)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ workspace:*
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/netgrep  — @netgrep/netgrep (TypeScript, ESM)           │
│   streaming, batching, in-memory cache, abort, error shaping     │
│   awaits init() once, then search_bytes per block of whole lines │
└───────────────────────────┬─────────────────────────────────────┘
                            │ workspace:*
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/search   — @netgrep/search (Rust → WASM)                │
│   search_bytes(&[u8], &str) -> Result<bool, JsError>             │
│   wasm-pack `web` target: new URL(…, import.meta.url)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ crates.io
┌───────────────────────────▼─────────────────────────────────────┐
│ grep-matcher · grep-regex · grep-searcher   (upstream ripgrep)   │
└─────────────────────────────────────────────────────────────────┘
```

The arrows are **pnpm workspace links**: local source, resolved from this repository. They used to be npm
dependencies on this repo's own published packages, which meant local edits reached neither the wrapper nor
the example — the single most expensive trap the project had. It is gone.

netgrep no longer depends on a ripgrep **fork**. The fork existed only to patch `std::time` usage in
`grep-printer`, `ignore` and the CLI core, none of which this project uses; they arrived solely because
`Cargo.toml` depended on the `grep` *meta-crate*. Depending on the three sub-crates directly means they are
never compiled. See [decision 0001](decisions/0001-fork-ripgrep-for-wasm.md).

---

## The Rust core — `packages/search`

`src/lib.rs` is ~135 lines, most of them comment, and exposes exactly one `#[wasm_bindgen]` function:

```rust
pub fn search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, JsError>
pub fn search_bytes_line(chunk: &[u8], pattern: &str, max_line_bytes: usize)
    -> Result<Option<String>, JsError>
```

wasm-bindgen unwraps those `Result`s, so the TypeScript a consumer sees is
`search_bytes(chunk: Uint8Array, pattern: string): boolean` and
`search_bytes_line(chunk: Uint8Array, pattern: string, max_line_bytes: number): string | undefined` — both
simply **throw** on a pattern the regex engine will not accept, rather than trapping the instance as they did
until 2026.

The second entry point exists so the first stays free. `Netgrep.ts` calls one or the other depending on
`captureLine`, so a caller who wants only membership allocates nothing, decodes nothing and copies no string
out of WebAssembly — the same call it has always made. `undefined` is the only no-match signal it returns: a
pattern matching an empty line yields `""`, which is falsy. Both share one compiled-matcher memo, so their
matching semantics cannot drift apart.

Per call it:

1. Reuses the **last compiled matcher** if the pattern is unchanged, and otherwise compiles a new one with
   `line_terminator(b'\n')` and **`case_smart(true)`** — smart case is hardcoded on and not configurable. A
   lowercase pattern matches case-insensitively; a pattern containing an uppercase character matches
   case-sensitively. netgrep calls this once per network chunk with the same pattern every time, so the cache
   hits on every chunk after the first; compilation was 97–99% of the cost before it existed. Failed compiles
   are cached alongside successful ones. See [decision 0016](decisions/0016-compiled-matcher-memo.md).
2. Builds a `Searcher` with `BinaryDetection::quit(b'\x00')` and `line_number(false)`.
3. Runs `search_slice` into `MemSink`, a minimal `Sink` implementation that does nothing but record that a
   match happened and stop — chosen because ripgrep's real sinks write to stdout, which does not exist in
   WASM.
4. Returns whether it matched.

The engine is split in two: `try_search_bytes` is plain Rust returning `Result<bool, String>`, and
`search_bytes` is a two-line `#[wasm_bindgen]` wrapper mapping that to a `JsError`. The split is not
tidiness — `JsError` is a wasm-bindgen import that panics if constructed on a native target, and the Rust
tests run natively.

The default Rust allocator is used. `wee_alloc` was the global allocator until 2026; it was removed once
measurement showed it saved 6,839 bytes — 0.6% — which no longer justified an unmaintained dependency with a
known leak in a published package's hot path. See [decision 0008](decisions/0008-wee-alloc.md).

The release profile (`lto`, `opt-level = 's'`, `codegen-units = 1`, `panic = 'abort'`) lives in the
**workspace root** `Cargo.toml`. It has to: Cargo silently ignores `[profile.*]` in a member package, and for
most of this project's life the size-tuned profile sat in `packages/search/Cargo.toml` doing nothing at all.

`index_bg.wasm` is **~1.16 MB** (1,164,691 bytes; ~500 KB gzipped) — every consumer downloads it. Roughly a
third is `regex-automata`'s DFA and Unicode tables.

---

## The TypeScript wrapper — `packages/netgrep`

`src/lib/Netgrep.ts` is the entire public surface. `src/lib/data/` holds five types, one per file.

`src/lib/splitAtLastLine.ts` sits beside it and is **not** re-exported by `index.ts` — `index.ts` is
`export * from './lib/Netgrep.js'`, so anything exported from that file would become public API. It is a
separate module rather than a private function so that its edge cases can be unit-tested directly, with a
tiny cap, instead of only through a >64 KB fixture in a browser.

### Public API

| Method | Returns | Semantics |
|---|---|---|
| `search(url, pattern, metadata?, config?)` | `Promise<NetgrepResult<T>>` | One URL. |
| `searchBatch(inputs, pattern, config?)` | `Promise<BatchNetgrepResult<T>[]>` | `Promise.all` — resolves only when **all** searches settle. Per-item errors are captured into `error`, never rejected. |
| `searchBatchWithCallback(inputs, pattern, cb, config?)` | `void` | Fires `cb` per completed search. **No completion signal** — the caller cannot know when the batch is done. |

`NetgrepConfig { enableMemoryCache }` (default `true`) is per-instance.
`NetgrepSearchConfig { signal }` is per-call and threads an `AbortSignal` into `fetch`.

`metadata` is an opaque generic `T` carried through untouched and returned on the result — the mechanism by
which a caller correlates results back to domain objects (a blog post, a document record).

### The search loop

```
search(url, pattern)
  │
  ├─ await wasmReady          ← init() started once at module load
  │
  ├─ cache enabled AND a search of this url is in flight?
  │     └─ yes → await it, then look again (it may have cached nothing)
  │
  ├─ cache enabled AND cache[url] exists?
  │     └─ yes → search_bytes(cache[url], pattern) → resolve
  │              (always the WHOLE file — entries are only written from a
  │               drained stream, so there are no boundaries inside one)
  │
  └─ register in inFlight[url] (cache enabled only), then
     fetch(url, { signal })
       └─ res.body.getReader()
            └─ handleReader(reader)   ── recursive
                 ├─ read() → { value, done }
                 │
                 ├─ done → search_bytes(tail, pattern)  ← the final line, which
                 │         │                              nothing has looked at
                 │         ├─ cache enabled → cache[url] = join(chunks)
                 │         └─ resolve(result)
                 │
                 ├─ cache enabled → chunks.push(value)
                 ├─ splitAtLastLine(tail ++ value, 64 KB)
                 │    ├─ searched ← whole lines
                 │    └─ tail     ← the incomplete trailing line, held back
                 ├─ searched non-empty → search_bytes(searched, pattern)
                 ├─ matched       → resolve(result: true)   ← stops reading
                 └─ not matched   → recurse
```

Two things about that shape are load-bearing, and both are [decision
0018](decisions/0018-line-oriented-tail-buffer.md):

- **The engine only ever sees whole lines.** A match cannot span a `\n`, so the incomplete trailing line is the
  exact carry-over between chunks — which is why a boundary cannot hide a match, and why it cannot fake a line
  start for `^` or a line end for `$` either. `splitAtLastLine` falls back to a 64 KB byte window when a line
  outgrows the ceiling, which is the one case where a match can still be lost (caveat 1).
- **The cache is written once, at `done`.** Resolving early therefore caches *nothing*, rather than caching a
  prefix that later answers questions about text it never downloaded (caveat 2). Chunks are only collected when
  the cache is enabled, so a search with it off holds one chunk plus the tail.

The two `cache enabled` branches at the top are [decision
0019](decisions/0019-in-flight-fetch-registry.md), and the second exists because the first is not a guarantee:
a waiter can wake to a cold cache, since the search it waited on may have matched early or failed. It then
fetches for itself rather than waiting again — queueing until the url is quiet would serialise callers that
used to fetch in parallel without saving a single request.

Errors are normalised to strings by `serializeError` — `Error.message`, or `JSON.stringify` for
non-`Error` throws. The recursive `handleReader` call carries a `.catch(reject)`: the promise it returns is not
chained to the one the executor was handed, so without it a rejection from any chunk after the first would be
an unhandled rejection and the search would never settle.

---

## Known limitations & correctness caveats

All verified against the source in this repository, and each is **pinned by a test** — in
`Netgrep.integration.spec.ts`, and for the ones that live in the engine also in the `documented_defects` module
of `packages/search/tests/search.rs`. Those tests assert the current, wrong behaviour; the ones marked
`(FIXED)` there were inverted in place when the defect was closed. See
[`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose) before touching
any of them.

**Documented, not fixed.** Caveats 1 and 2 were both closed on 2026-07-30 by
[decision 0018](decisions/0018-line-oriented-tail-buffer.md), and they had to be closed together: caveat 1 was
suppressing early resolution, so fixing it alone would have made caveat 2 fire more often, in the default
configuration. Caveat 1's *residual* is what remains, and is described below. Caveat 7 was closed the same day
by [decision 0019](decisions/0019-in-flight-fetch-registry.md), for instances running with the cache on.

### 1. Chunk-boundary false negatives — FIXED, with a residual

`search_bytes` used to be called with **one chunk at a time**, never overlapped or joined, so a pattern
straddling the boundary between two `fetch` chunks was never seen by the matcher. A silent wrong answer whose
trigger depended on how the network split the response.

`Netgrep.search` now retains the **incomplete trailing line** of everything read so far and prepends it to the
next chunk, handing the engine only whole lines (`splitAtLastLine`). That is exact rather than approximate,
because a match can never span a `\n` — grep-regex strips the terminator out of character classes and rejects
patterns containing a literal one. The invariant is asserted by
`test_a_match_cannot_span_a_line_terminator`, which names its JavaScript dependant in a comment: **if that
test breaks, this caveat is back and no JavaScript test will notice.**

Fixing it also removed the mirror-image false *positives* that were never separately tracked. A chunk searched
in isolation looked to `^` like the start of a line and to `$` like the end of one, so both invented matches at
a seam.

> **Residual (item 3g) — a line longer than 64 KB.** Such a line would otherwise buffer an entire response, so
> past a 64 KB ceiling (`MAX_TAIL_BYTES`, not configurable) the tail degrades to a plain window on the last
> 64 KB. Inside such a line, three things break: a match **longer** than 64 KB is lost; `^` can match at the
> window's first byte, because a windowed tail starts mid-line and the engine cannot be told so; and a line
> captured with `captureLine` begins at that same arbitrary byte, so it is a fragment rather than a line —
> `result` stays correct, and returning `null` there was rejected in
> [decision 0020](decisions/0020-the-matching-line.md). All three need a line longer than 64 KB, so all three
> are unreachable in hand-written text — the demo corpus is 2.6 MB of prose whose longest line is 76 bytes.
> Pinned by the three `BACKLOG 3g` tests in `Netgrep.integration.spec.ts`, each alongside its control case.

Newline-free input is answered more slowly than before, since nothing is searched until the ceiling fills or
the stream ends. Correct either way — the end-of-stream flush catches a file smaller than the ceiling.

### 2. Poisoned partial cache — FIXED

`upsertMemoryCache` appended each chunk as it arrived, but the loop **resolves and stops reading the moment a
match is found**, so the cache was left holding only the *prefix* downloaded so far, with no marker that it was
incomplete. A later search for a different pattern took the cache-hit branch and searched that truncated
prefix, returning `false` for text that was never downloaded.

The entry is now written **only when the reader reports `done`**, so a partial one is never created rather than
created and flagged. An early resolution therefore caches nothing and the next search re-fetches — a wasted
request in place of a confident wrong answer. Note that a match in the *final* chunk still caches nothing: the
stream is not known to be complete until `done`, which is one read later.

This is narrower than the completeness flag originally proposed here, and deliberately so: a partial entry
cannot resume a download either, and nothing needed it to.

### 3. Unbounded cache growth — `Netgrep.ts`, the `memoryCache` record

The cache is a plain `Record<string, Uint8Array>` with no eviction, no size cap and no TTL. It retains the
full bytes of every file searched for the lifetime of the `Netgrep` instance.

The O(n²) population this caveat also described is gone: chunks are collected in an array and joined once, and
they are only collected at all when the cache is enabled — so a search with it off retains one chunk plus the
tail rather than the whole file.

### 4. No completion signal from `searchBatchWithCallback`

It returns `void` and starts every search eagerly with no concurrency limit. Callers cannot await it, cannot
detect completion, and a batch of N URLs opens N simultaneous connections.

### 5. One NUL byte discards the whole searched block — `lib.rs`, `BinaryDetection::quit`

`BinaryDetection::quit(b'\x00')` does not stop *at* the NUL — it abandons everything it was handed. A match is
dropped even when it occurs before the NUL, and even on an earlier line. Any remote file containing a stray
NUL therefore reports "no match" for content that is demonstrably present.

Quitting on binary input is a reasonable ripgrep default; the surprise is that the API cannot distinguish
"binary, not searched" from "no match" — `captureLine` does not help, since a discarded block reports no match
and therefore no line.

Decision 0018 changed the *shape* of this without fixing it. What the engine is handed is no longer the network
chunk but the block of complete lines within it, so how far a NUL reaches now depends on where the last `\n`
falls rather than on where the network split the response — and a match on an earlier line survives *if* the
NUL happens to land in the held-back partial line. Both behaviours are pinned, so that accident is not mistaken
for a fix.

### 6. `$` does not match on CRLF input — `lib.rs`, no `.crlf(true)` on the matcher

The searcher is given `line_terminator(Some(b'\n'))`, so on a Windows-authored file the `\r` is the last
character of the line and `$` sits behind it. `needle$` matches `"needle\n"` and does **not** match
`"needle\r\n"`, while plain `needle` matches both. `^` is unaffected — the CR is at the other end.

Silent, and it depends on who wrote the file rather than on anything the caller did.
`RegexMatcherBuilder::crlf(true)` is the one-line fix; it is a matching-semantics change, so it is a
deliberate task rather than a drive-by.

### 7. Concurrent searches of one url both fetch it — FIXED with the cache on, unchanged with it off

Nothing used to track a download already in flight, so two searches of one url started before either resolved
both `fetch`ed it. The sharp half went first, in decision 0018: the cache entry used to be *appended* to per
chunk, so the two copies were joined with no separator and the seam formed a line that existed nowhere — a file
of `needle` cached as `needleneedle`, and `^needleneedle$` answered `true`.

The wasted request went in [decision 0019](decisions/0019-in-flight-fetch-registry.md). `search` keeps a per-url
registry of in-flight searches; a second caller of the same url waits on the first and is then answered from the
cache entry the first one writes.

That entry is the handover, which is why the de-duplication only applies with the **cache on**. With it off there
is nothing to hand a waiter — sharing would mean retaining every chunk of a file nobody asked to keep, or teeing
the response stream and with it the first caller's abort signal — so both callers still fetch, deliberately.
Two further cases fall back to fetching, both pinned: a first caller that matches early resolves without
draining and writes no entry, and a failed download is not inherited by its waiter, which retries with its own
signal.

---

## Build & release pipeline

### `packages/search` (Rust → WASM)

```
wasm-pack build --scope netgrep --out-name index --target web --release
  → packages/search/pkg/{index.js, index_bg.wasm, index.d.ts, package.json}
node scripts/post_build.js
```

`post_build.js` does three things, all of them load-bearing:

1. Marks `pkg/` as ESM — `wasm-pack` does not emit `"type": "module"`.
2. Copies the version from `Cargo.toml` into `packages/search/package.json`, so the Rust and npm manifests
   cannot drift.
3. **Deletes the `.gitignore` `wasm-pack` writes into `pkg/`.** It contains `*`, and npm honours a
   package-internal `.gitignore` when there is no `.npmignore` — combined with `"files": ["pkg"]` that once
   produced a tarball containing no WASM at all.

The **`web`** target matters: its entry loads the binary via `new URL('index_bg.wasm', import.meta.url)`,
which every current bundler understands. The previous `bundler` target used an ESM-integration wasm import
that only webpack supported, and that failed *silently* under Vite — see
[decision 0005](decisions/0005-esm-only-distribution.md).

### `packages/netgrep` (TypeScript)

`tsc -p tsconfig.lib.json` compiles to `packages/netgrep/dist/`. The published manifest is the hand-written
`packages/netgrep/package.json`, not a synthesised one.

### CI — `.github/workflows/`

| Workflow | Trigger | Action |
|---|---|---|
| `test-and-lint.yml` | PR to `main`, or called | Five jobs plus an aggregate — see below |
| `release.yml` | push to `main` | test-and-lint → release-please → publishes → deploy |
| `publish-search.yml` | called, or dispatched | `build:wasm` → npm publish `packages/search/package.json` |
| `publish-netgrep.yml` | called, or dispatched | `build:wasm` → `build` → npm publish `packages/netgrep/package.json` |
| `deploy-pages.yml` | called, or dispatched | `build:wasm` → `build` → `build:example` → Pages |

`test-and-lint.yml` groups its work **by toolchain**, which is what a job actually pays to install:

```
wasm ──┬── browser  (test:browser) ──────────────────┐
       └── bundle   (typecheck, build, verify:pack) ─┤
                                                     ├── ci  (aggregate; the check to require)
rust  (lint:rust, test:rust) ────────────────────────┤
js    (lint:js, test:unit) ──────────────────────────┘
```

`wasm` runs `build:wasm` and uploads `packages/search/pkg` as an artefact, so the two jobs that need it
download it instead of recompiling the ripgrep tree. `rust` and `js` need nothing from it — the unit suite
mocks the engine — so they do not wait. Setup is shared through the composite actions in `.github/actions/`.

Steps after the first in a job carry `if: '!cancelled()'`, so one failing command does not hide the ones
after it; that was the original single job's worst property, and it is a step-level problem rather than a
reason to have more jobs. A job-per-command version was built and measured first: 108s wall clock against
~110s sequential, at twice the runner time. See
[decision 0015](decisions/0015-ci-jobs-grouped-by-toolchain.md).

`release.yml` is the release pipeline. It runs the test graph, then release-please, then the two publishes in
dependency order, then the deploy — all in one run, gated on release-please's `*--release_created` outputs
rather than on tags. Three properties of it are load-bearing:

- **Tests run before release-please.** The action tags unconditionally, so the conventional order leaves a
  tag and a public GitHub Release for a version that never reached npm.
- **Nothing triggers on a tag.** release-please tags with `GITHUB_TOKEN`, and GitHub will not trigger a
  workflow from an event pushed with it, so a `push: tags` trigger would silently never fire.
- **`publish-netgrep` needs `publish-search`**, because `workspace:*` resolves to an exact version at pack
  time and the wrapper does not install before the core is on npm.

The three called workflows also accept `workflow_dispatch`, because a publish that fails *after* the tag
exists cannot be retried by re-running `release.yml` — release-please reports `release_created: false` the
second time and every publish job skips. They carry no test gate of their own, so each refuses a manual run
whose ref is not `main`.

Both publish workflows use `JS-DevTools/npm-publish@v3`, whose default `strategy: upgrade` makes a re-run
over an already-published version a no-op rather than a failure, and both set `provenance: true`, so npm
records which workflow and commit built the tarball. They rebuild the WASM rather than take the tested
artefact, on purpose — the trade-off is noted in `publish-search.yml`.

Versions come from `release-please-config.json`: `search` and `netgrep` are locked to one number by the
`linked-versions` plugin, `example` versions on its own, and the `cargo-workspace` plugin updates the
workspace-root `Cargo.lock` — which the `rust` strategy alone misses, because it only looks for a lock inside
the package directory.

`verify:pack` exists because every other check inspects the working tree, while the tarball is the only
artefact a consumer ever receives. That gap is how a published package containing no WASM became possible.

Workflows read the pinned versions from `rust-toolchain.toml` and `.node-version` rather than restating them,
so local and CI cannot drift the way they once did. `.github/actions/rust` parses the channel, targets and
components straight out of `rust-toolchain.toml`.

---

## Testing strategy

| Suite | Runner | What it covers |
|---|---|---|
| `splitAtLastLine.spec.ts` | Vitest in **Node**, 11 tests | The chunk-boundary tail arithmetic in isolation, with `cap = 8` so the over-the-ceiling cases fit on one line. A pure function, so no mocks at all. |
| `Netgrep.spec.ts` | Vitest in **Node**, 34 tests | Orchestration only — `fetch` **and** `@netgrep/search` are mocked. Result shape, metadata, abort plumbing, error capture and serialisation, config defaults, cache scope and accumulation, and all three public methods including `searchBatchWithCallback`. |
| `Netgrep.integration.spec.ts` | Vitest in **headless Chromium** (Playwright), 32 tests | **The real engine through the real streaming loop, in a real browser.** Only `fetch` is faked, and only to remove the network: bytes still travel through a real `ReadableStream`, still arrive chunked, still get matched by the compiled `search_bytes`. |
| `packages/search/tests/search.rs` | `cargo test`, native, 28 tests | `try_search_bytes` as pure Rust — bytes in, bool out. Regex features, smart case, line semantics, encoding and BOM handling, binary detection, and the compiled-matcher cache. No browser involved. |
| `scripts/verify-pack.mjs` | Node, in CI | The published tarballs: required files present, no `workspace:` range survived packing, no version drift. |

The split between the Rust and TypeScript suites is deliberate: anything that depends only on the bytes is cheapest to pin
in Rust, where a failure names the engine; anything about streaming, batching or caching belongs in the
TypeScript suites. They overlap at exactly one point — smart case — because it is the behaviour most likely
to move silently under a dependency bump, and knowing *which* layer moved is worth one duplicated assertion.

The integration suite loads **the artefact that actually ships** (`packages/search/pkg`) and instantiates it
through its own real, fetch-based `init()` — the same loader a consumer gets, resolving `index_bg.wasm`
relative to `import.meta.url` over HTTP. There is no separate Node-target build to drift from what consumers
receive, and no `initSync`-from-disk accommodation either: that was a Node limitation, and the loader it hid
is precisely the part that failed silently under Vite in [decision 0005](decisions/0005-esm-only-distribution.md).

Why a browser at all, and why Playwright rather than ChromeDriver:
[decision 0013](decisions/0013-playwright-for-browser-tests.md).

Its last block deliberately asserts **incorrect** behaviour, pinning the caveats above so that an unintended
change is caught. Read
[`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose) before editing it.
That block has already earned its place: modernizing the ripgrep dependencies silently *fixed* the
`^`-anchoring bug, and nothing else would have noticed.

The example is the public demo at <https://netgrep.diegopasquali.com/>. It runs against local workspace
source, so it is honest, and CI typechecks and builds it — but nothing asserts what it *renders*, so it
establishes no correctness. It searches with the in-memory cache disabled, because two of the P1 defects
below exist only when that cache is on; see [decision 0017](decisions/0017-example-as-hosted-demo.md).
