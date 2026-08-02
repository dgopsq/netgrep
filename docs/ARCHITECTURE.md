# Architecture

How netgrep is built and why it behaves the way it does. For *decisions* and their rationale see
[`decisions/`](decisions/). For how to work in the repo see [`../AGENTS.md`](../AGENTS.md).

---

## Scope

netgrep answers one question: **does `pattern` occur in the file at `url`?** The answer is a `boolean`, and —
if the caller passes `capture` — the **first matching line**, and with `capture: 'line-ranges'` each match's
position within that line. No line numbers, no file-wide byte offsets, no match counts, no ranking;
[decision 0020](decisions/0020-the-matching-line.md) records why the line was worth adding and
[0022](decisions/0022-capture-ranges.md) why positions within it are, along with why the rest stay refused.

The distinguishing property is *when* it answers: the search runs against each chunk of the HTTP response
**as it arrives**, so a match in the first kilobyte resolves without waiting for the remaining megabytes.

It is a browser-targeted library. It requires `fetch` with a readable response body stream. It needs **no
bundler configuration**: since 0.2.0 the WASM is loaded through a standard
`new URL('index_bg.wasm', import.meta.url)`, which Vite, webpack 5, Rollup, esbuild, Parcel and Bun all
understand out of the box.

It also requires a URL the browser is allowed to read: a cross-origin file must be served with
`Access-Control-Allow-Origin`, or the fetch rejects before a byte is searched, and it rejects with an opaque
network error rather than anything netgrep can explain. That is the first gate a remote file has to pass, so
it is a requirement rather than a caveat — and it bounds the *file you do not control* claim below to files
whose **host** cooperates.

It is not the only gate. netgrep builds its own request and sets nothing on it beyond `signal`, so no
`Authorization` header and no API key go out, and `Request.credentials` defaults to `same-origin`, so no
cookies go cross-origin either. A file behind a login is therefore fetched as an anonymous stranger and
cannot be searched, however permissive its CORS policy — a host can answer `Access-Control-Allow-Origin: *`
and still refuse the reader. That bound bites hardest on exactly the files this project positions itself
around, and lifting it is [`BACKLOG`](BACKLOG.md) item **22**.

**Non-goals:** indexing, ranking, positions in the *file*, Node.js support, filesystem search, a CLI.
(Positions within the returned line are in scope since 0022; nothing else about locating a match is.)

**The positioning is deliberate** — [decision 0025](decisions/0025-streaming-grep-over-http.md).
netgrep is grep over HTTP: a regex engine answering a question about a remote file in constant memory,
before the download finishes. Against a large corpus, or one you can preprocess, a prebuilt index wins
on size, speed and capability; netgrep's ground is a file you do not control, cannot preprocess, and have no
shell on the machine that holds the file. That is also why the correctness caveats below are documented
rather than hidden, and why the API has widened exactly once in four years — twice, if
[0022](decisions/0022-capture-ranges.md)'s positions within the returned line are counted apart from
[0020](decisions/0020-the-matching-line.md)'s line itself.

---

## The three packages

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/example  — the public demo, deployed to GitHub Pages     │
│   Vite + React + Tailwind, 56 .txt files, debounced input →      │
│   searchBatchWithCallback (decision 0017)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ workspace:*
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/netgrep  — @netgrep/netgrep (TypeScript, ESM)           │
│   streaming, batching, abort, error shaping — retains nothing    │
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

`src/lib.rs` is ~430 lines, most of them comment, and exposes three `#[wasm_bindgen]` functions:

```rust
pub fn search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, JsError>
pub fn search_bytes_line(chunk: &[u8], pattern: &str, max_line_bytes: usize)
    -> Result<Option<String>, JsError>
pub fn search_bytes_line_ranges(chunk: &[u8], pattern: &str, max_line_bytes: usize)
    -> Result<Option<LineWithRanges>, JsError>
```

wasm-bindgen unwraps those `Result`s, so the TypeScript a consumer sees is
`search_bytes(chunk: Uint8Array, pattern: string): boolean`,
`search_bytes_line(chunk: Uint8Array, pattern: string, max_line_bytes: number): string | undefined`, and a
third returning a `LineWithRanges | undefined` carrying the same `line` plus a flat
`Uint32Array` of `[start, end, …]` — all three simply **throw** on a pattern the regex engine will not accept,
rather than trapping the instance as they did until 2026.

The extra entry points exist so the first stays free. `Netgrep.ts` calls one of the three depending on
`capture`, so a caller who wants only membership allocates nothing, decodes nothing and copies no string out
of WebAssembly — the same call it has always made, and the line path pays for no ranges it did not ask for.
`undefined` is the only no-match signal any of them returns: a pattern matching an empty line yields `""`,
which is falsy. All three share one compiled-matcher memo and one searcher, so their matching semantics and
binary detection cannot drift apart.

The ranges are computed only after the search has ended, by running the same compiled matcher over the kept
line — bounded by the line, off the hot path. Conversion to UTF-16 code units happens against the decoded,
truncated string, since a byte offset into the input would be wrong wherever lossy decoding substituted
`U+FFFD`. See [decision 0022](decisions/0022-capture-ranges.md).

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

`index_bg.wasm` is **~1.17 MB** (1,169,300 bytes; ~500 KB gzipped) — every consumer downloads it. Roughly a
third is `regex-automata`'s DFA and Unicode tables.

---

## The TypeScript wrapper — `packages/netgrep`

`src/lib/Netgrep.ts` is the entire public surface. `src/lib/data/` holds six types, one per file.

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

The constructor takes no arguments — the library retains nothing between searches, so there is nothing to
configure ([0024](decisions/0024-remove-the-in-memory-cache.md)).
`NetgrepSearchConfig { signal, capture, maxLineBytes }` is per-call and is all the configuration there is:
`signal` threads an `AbortSignal` into `fetch`, and the other two select and bound what comes back beside the
boolean ([0020](decisions/0020-the-matching-line.md), [0022](decisions/0022-capture-ranges.md)).

`metadata` is an opaque generic `T` carried through untouched and returned on the result — the mechanism by
which a caller correlates results back to domain objects (a blog post, a document record).

### The search loop

```
search(url, pattern)
  │
  ├─ await wasmReady          ← init() started once at module load
  │
  └─ fetch(url, { signal })
       └─ res.body.getReader()
            └─ handleReader(reader)   ── recursive
                 ├─ read() → { value, done }
                 │
                 ├─ done → search_bytes(tail, pattern)  ← the final line, which
                 │         │                              nothing has looked at
                 │         └─ resolve(result)
                 │
                 ├─ splitAtLastLine(tail ++ value, 64 KB)
                 │    ├─ searched ← whole lines
                 │    └─ tail     ← the incomplete trailing line, held back
                 ├─ searched non-empty → search_bytes(searched, pattern)
                 ├─ matched       → resolve(result: true)   ← cancels the reader,
                 │                                              ending the transfer
                 └─ not matched   → recurse
```

Three things about that shape are load-bearing:

- **The engine only ever sees whole lines** ([decision 0018](decisions/0018-line-oriented-tail-buffer.md)). A
  match cannot span a `\n`, so the incomplete trailing line is the exact carry-over between chunks — which is
  why a boundary cannot hide a match, and why it cannot fake a line start for `^` or a line end for `$`
  either. `splitAtLastLine` falls back to a 64 KB byte window when a line outgrows the ceiling, which is the
  one case where a match can still be lost (caveat 1).
- **Nothing is retained between reads.** One chunk plus the incomplete line at its end, bounded at 64 KB,
  however long the file is. There is no accumulation and no cache
  ([0024](decisions/0024-remove-the-in-memory-cache.md)) — which is what makes the memory cost independent of
  the response size.
- **A match cancels the reader.** `resolve` on a hit is paired with `reader.cancel()`, which terminates the
  underlying request instead of merely stopping local reads — otherwise the rest of the file would keep
  arriving, and being paid for, after the answer was already known.

Errors are normalised to strings by `serializeError` — `Error.message`, or `JSON.stringify` for
non-`Error` throws. The recursive `handleReader` call carries a `.catch(reject)`: the promise it returns is not
chained to the one the executor was handed, so without it a rejection from any chunk after the first would be
an unhandled rejection and the search would never settle.

---

## Known limitations & correctness caveats

All verified against the source in this repository, and every one still open is **pinned by a test** — in
`Netgrep.integration.spec.ts`, and for the ones that live in the engine also in the `documented_defects` module
of `packages/search/tests/search.rs`. Those tests assert the current, wrong behaviour; the ones marked
`(FIXED)` there were inverted in place when the defect was closed. Two left the block on 2026-08-01 rather
than being inverted in it, because the code they described was deleted rather than corrected — the rule is in
[`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose), which is worth
reading before touching any of them.

**Documented, not fixed.** Caveats 1 and 2 were both closed on 2026-07-30 by
[decision 0018](decisions/0018-line-oriented-tail-buffer.md), and they had to be closed together: caveat 1 was
suppressing early resolution, so fixing it alone would have made caveat 2 fire more often, in the default
configuration. Caveat 1's *residual* is what remains, and is described below. Caveats 2 and 3 were then
overtaken entirely on 2026-08-01 by [decision 0024](decisions/0024-remove-the-in-memory-cache.md), which
deleted the cache both of them described; their headings are kept because the numbering is referenced from
this file's own text and from [decision 0002](decisions/0002-search-while-downloading.md), which cites both by
number. Caveat 7 stopped being a defect on the same day, for the same reason, and is now a design consequence.

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
> captured with `capture` begins at that same arbitrary byte, so it is a fragment rather than a line — and
> with `capture: 'line-ranges'` its `ranges` can come back empty, since the fragment need not contain the
> match. `result` stays correct, and returning `null` there was rejected in
> [decision 0020](decisions/0020-the-matching-line.md). All three need a line longer than 64 KB, so all three
> are unreachable in hand-written text — the demo corpus is 2.6 MB of prose whose longest line is 76 bytes.
> Pinned by the three `BACKLOG 3g` tests in `Netgrep.integration.spec.ts`, each alongside its control case.

Newline-free input is answered more slowly than before, since nothing is searched until the ceiling fills or
the stream ends. Correct either way — the end-of-stream flush catches a file smaller than the ceiling.

### 2. Poisoned partial cache — CLOSED BY REMOVAL

An early resolution used to leave the cache holding only the *prefix* downloaded so far, with no marker that
it was incomplete, and a later search for a different pattern answered `false` from that truncated prefix.
Decision 0018 narrowed it to nothing by writing the entry only from a drained stream;
[decision 0024](decisions/0024-remove-the-in-memory-cache.md) then deleted the cache, so there is no entry to
be partial and no branch that would read one. Kept as a heading because caveats are referred to here by
number.

### 3. Unbounded cache growth — CLOSED BY REMOVAL

The cache was a plain `Record<string, Uint8Array>` with no eviction, no size cap and no TTL, retaining the
full bytes of every file searched for the lifetime of the `Netgrep` instance — backlog item 19. It was closed
by deleting the cache rather than by adding eviction, in
[decision 0024](decisions/0024-remove-the-in-memory-cache.md): the eviction it asked for is the browser HTTP
cache's, and netgrep now retains nothing between searches, so there is no growth left to bound.

### 4. No completion signal from `searchBatchWithCallback`

It returns `void` and starts every search eagerly with no concurrency limit. Callers cannot await it, cannot
detect completion, and a batch of N URLs opens N simultaneous connections.

### 5. One NUL byte discards the whole searched block — `lib.rs`, `BinaryDetection::quit`

`BinaryDetection::quit(b'\x00')` does not stop *at* the NUL — it abandons everything it was handed. A match is
dropped even when it occurs before the NUL, and even on an earlier line. Any remote file containing a stray
NUL therefore reports "no match" for content that is demonstrably present.

Quitting on binary input is a reasonable ripgrep default; the surprise is that the API cannot distinguish
"binary, not searched" from "no match" — `capture` does not help, since a discarded block reports no match and
therefore no line.

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

### 7. Concurrent searches of one url each download it — BY DESIGN

Two searches of one url that overlap both `fetch` it. The answers are correct; the second request is wasted.

This was a defect twice, and is one no longer. Its sharp half — the entry was *appended* to per chunk, so two
copies were joined with no separator and the seam formed a line that existed nowhere, a file of `needle`
cached as `needleneedle` — went in decision 0018. The wasted request went in
[decision 0019](decisions/0019-in-flight-fetch-registry.md), which made a second caller wait for the first and
answer from the cache entry it wrote. **That entry was the handover**, so when
[decision 0024](decisions/0024-remove-the-in-memory-cache.md) deleted the cache the registry went with it:
with nothing retained there is nothing to hand a waiter.

Reinstating the sharing needs one of the two things 0019 already rejected — retaining every chunk of a file
nobody asked to keep, or teeing the response stream and with it the first caller's abort signal, which turns a
wasted request into a wrong answer. So both callers fetch, deliberately, and the browser's own HTTP cache
decides what the repeat actually costs. Pinned by *fetches once per concurrent search of one url, by design*
in `Netgrep.integration.spec.ts` — an ordinary assertion, not a defect one.

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
| `splitAtLastLine.spec.ts` | Vitest in **Node**, 12 tests | The chunk-boundary tail arithmetic in isolation, with `cap = 8` so the over-the-ceiling cases fit on one line. A pure function, so no mocks at all. |
| `Netgrep.spec.ts` | Vitest in **Node**, 48 tests | Orchestration only — `fetch` **and** `@netgrep/search` are mocked. Result shape, metadata, abort plumbing, error capture and serialisation, and all three public methods including `searchBatchWithCallback`. |
| `Netgrep.integration.spec.ts` | Vitest in **headless Chromium** (Playwright), 47 tests | **The real engine through the real streaming loop, in a real browser.** Only `fetch` is faked, and only to remove the network: bytes still travel through a real `ReadableStream`, still arrive chunked, still get matched by the compiled `search_bytes`. |
| `packages/search/tests/search.rs` | `cargo test`, native, 57 tests | The three `try_*` entry points as pure Rust — bytes in, bool/line/ranges out. Regex features, smart case, line semantics, encoding and BOM handling, binary detection, the compiled-matcher cache, and the UTF-16 offset conversion including its lossy-decoding and truncation edges. No browser involved. |
| `scripts/verify-pack.mjs` | Node, in CI | The published tarballs: required files present, no `workspace:` range survived packing, no version drift. |

The split between the Rust and TypeScript suites is deliberate: anything that depends only on the bytes is cheapest to pin
in Rust, where a failure names the engine; anything about streaming, batching or aborting belongs in the
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
establishes no correctness. Its timings measure the network, and since
[decision 0024](decisions/0024-remove-the-in-memory-cache.md) that is true by construction rather than by
configuration — the library retains nothing to answer a second query from. See
[decision 0017](decisions/0017-example-as-hosted-demo.md).
