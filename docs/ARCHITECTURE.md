# Architecture

How netgrep is built and why it behaves the way it does. For *decisions* and their rationale see
[`decisions/`](decisions/). For how to work in the repo see [`../AGENTS.md`](../AGENTS.md).

---

## Scope

netgrep answers one question: **does `pattern` occur in the file at `url`?** The answer is a `boolean`.
No line numbers, no byte offsets, no matched text, no match counts.

The distinguishing property is *when* it answers: the search runs against each chunk of the HTTP response
**as it arrives**, so a match in the first kilobyte resolves without waiting for the remaining megabytes.

It is a browser-targeted library. It requires `fetch` with a readable response body stream. It needs **no
bundler configuration**: since 0.2.0 the WASM is loaded through a standard
`new URL('index_bg.wasm', import.meta.url)`, which Vite, webpack 5, Rollup, esbuild, Parcel and Bun all
understand out of the box.

**Non-goals:** indexing, ranking, snippets, highlighting, Node.js support, filesystem search, a CLI.

**It is an experiment rather than a recommended way to build search**, and the public README leads with that.
A prebuilt index will usually beat it on size, speed and capability; what netgrep tests is whether ripgrep's
real engine is usable over HTTP against files as they download. That framing is why the correctness caveats
below are documented rather than hidden, and why the API has stayed a boolean.

---

## The three packages

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/example  — webpack 5 demo, not published                │
│   plain JS, 67 .txt files, debounced input → searchBatch         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ workspace:*
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/netgrep  — @netgrep/netgrep (TypeScript, ESM)           │
│   streaming, batching, in-memory cache, abort, error shaping     │
│   awaits init() once, then calls search_bytes per chunk          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ workspace:*
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/search   — @netgrep/search (Rust → WASM)                │
│   search_bytes(&[u8], &str) -> bool                              │
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

`src/lib.rs` is ~45 lines and exposes exactly one `#[wasm_bindgen]` function:

```rust
pub fn search_bytes(chunk: &[u8], pattern: &str) -> bool
```

Per call it:

1. Builds a `RegexMatcherBuilder` with `line_terminator(b'\n')` and **`case_smart(true)`**
   — smart case is hardcoded on and not configurable. A lowercase pattern matches case-insensitively;
   a pattern containing an uppercase character matches case-sensitively.
2. Builds a `Searcher` with `BinaryDetection::quit(b'\x00')` and `line_number(false)`.
3. Runs `search_slice` into `MemSink`, a minimal `Sink` implementation that does nothing but increment a
   counter — chosen because ripgrep's real sinks write to stdout, which does not exist in WASM.
4. Returns `match_count > 0`.

The default Rust allocator is used. `wee_alloc` was the global allocator until 2026; it was removed once
measurement showed it saved 6,839 bytes — 0.6% — which no longer justified an unmaintained dependency with a
known leak in a published package's hot path. See [decision 0008](decisions/0008-wee-alloc.md).

The release profile (`lto`, `opt-level = 's'`, `codegen-units = 1`, `panic = 'abort'`) lives in the
**workspace root** `Cargo.toml`. It has to: Cargo silently ignores `[profile.*]` in a member package, and for
most of this project's life the size-tuned profile sat in `packages/search/Cargo.toml` doing nothing at all.

`index_bg.wasm` is **~1.15 MB** (1,148,922 bytes; ~480 KB gzipped) — every consumer downloads it. Roughly a
third is `regex-automata`'s DFA and Unicode tables.

---

## The TypeScript wrapper — `packages/netgrep`

`src/lib/Netgrep.ts` is the entire public surface. `src/lib/data/` holds five types, one per file.

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
  ├─ cache enabled AND cache[url] exists?
  │     └─ yes → search_bytes(cache[url], pattern) → resolve   ← see caveat 2
  │
  └─ fetch(url, { signal })
       └─ res.body.getReader()
            └─ handleReader(reader)   ── recursive
                 ├─ read() → { value, done }
                 ├─ done          → resolve(result: false)
                 ├─ search_bytes(chunk, pattern)   ← see caveat 1
                 ├─ cache enabled → append chunk to cache[url]
                 ├─ matched       → resolve(result: true)   ← stops reading
                 └─ not matched   → recurse
```

Errors are normalised to strings by `serializeError` — `Error.message`, or `JSON.stringify` for
non-`Error` throws.

---

## Known limitations & correctness caveats

All verified against the source in this repository, and each is **pinned by a test that asserts the current,
wrong behaviour** — in `Netgrep.integration.spec.ts`, and for the ones that live in the engine also in the
`documented_defects` module of `packages/search/tests/search.rs`. See
[`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose) before touching
any of them.

**Documented, not fixed.** Caveats 1 and 2 interact: fixing either one naively reintroduces or worsens the
other.

### 1. Chunk-boundary false negatives — `Netgrep.ts`, the `search_bytes` call in `handleReader`

`search_bytes(u8Array, pattern)` is called with **one chunk at a time**, and chunks are never overlapped or
joined before searching. A pattern that straddles the boundary between two `fetch` chunks is never seen by the
matcher.

Silent wrong answer: `result: false` for a file that does contain the pattern. Whether it triggers depends on
network chunking, so it is non-deterministic across runs and effectively untestable by luck.

*Any fix requires retaining a tail buffer of at least `pattern.length - 1` bytes (more for regex patterns,
where the maximum match length is not knowable from the pattern alone) and prepending it to the next chunk.*

### 2. Poisoned partial cache — `Netgrep.ts`, `handleReader` and the cache-hit branch of `search`

`upsertMemoryCache` appends each chunk as it arrives, but the loop **resolves and stops reading the moment a
chunk matches**. The cache is then left holding only the *prefix* of the file downloaded so far, with no
marker that it is incomplete.

A later search on the same URL for a different pattern takes the cache-hit branch at the top of `search` and
searches that truncated prefix — returning `false` for text that was never downloaded.

Reproduction: search a large file for a term near the top (populates a short prefix), then search the same URL
for a term near the bottom → `false`.

*Any fix needs a completeness flag per cache entry, so partial entries are only ever used to resume, never to
answer.*

### 3. Unbounded cache growth — `Netgrep.ts`, `upsertMemoryCache`

The cache is a plain `Record<string, Uint8Array>` with no eviction, no size cap and no TTL. It retains the
full bytes of every file searched for the lifetime of the `Netgrep` instance. `upsertMemoryCache` also
reallocates and copies the whole accumulated buffer **per chunk**, making cache population O(n²) in bytes.

### 4. Regex recompiled per chunk — `lib.rs`, the `RegexMatcherBuilder` in `search_bytes`

`search_bytes` builds a fresh `RegexMatcher` on **every call**, i.e. once per network chunk per file. Regex
compilation is the expensive part of a small search; this discards it every time.

### 5. Panic on invalid pattern

`.build(pattern).unwrap()` panics inside WASM if the pattern is not valid regex. Since patterns typically come
straight from a user-facing search box, a stray `(` or `[` surfaces as a wasm trap
(`RuntimeError: unreachable`) rather than a catchable domain error. The instance does remain usable
afterwards.

### 6. No completion signal from `searchBatchWithCallback`

It returns `void` and starts every search eagerly with no concurrency limit. Callers cannot await it, cannot
detect completion, and a batch of N URLs opens N simultaneous connections.

### 7. One NUL byte discards the whole chunk — `lib.rs`, `BinaryDetection::quit`

`BinaryDetection::quit(b'\x00')` does not stop *at* the NUL — it abandons the entire chunk. A match is
dropped even when it occurs before the NUL, and even on an earlier line. Any remote file containing a stray
NUL therefore reports "no match" for content that is demonstrably present.

Quitting on binary input is a reasonable ripgrep default; the surprise is that the API cannot distinguish
"binary, not searched" from "no match", because the API is a boolean.

### 8. `$` does not match on CRLF input — `lib.rs`, no `.crlf(true)` on the matcher

The searcher is given `line_terminator(Some(b'\n'))`, so on a Windows-authored file the `\r` is the last
character of the line and `$` sits behind it. `needle$` matches `"needle\n"` and does **not** match
`"needle\r\n"`, while plain `needle` matches both. `^` is unaffected — the CR is at the other end.

Silent, and it depends on who wrote the file rather than on anything the caller did.
`RegexMatcherBuilder::crlf(true)` is the one-line fix; it is a matching-semantics change, so it is a
deliberate task rather than a drive-by.

### 9. Concurrent searches of one url double its cache entry — `Netgrep.ts`, `search`

Nothing tracks a download already in flight. Two searches of the same url started before either resolves both
`fetch`, and both append what they read to the same cache entry.

The waste is the obvious half. The sharp half is that the entry then holds bytes the file never contained:
the copies are joined with no separator, so the seam forms a line that exists nowhere and a later search
matches it. A file of `needle` caches as `needleneedle`, and `^needleneedle$` answers `true`.

*A fix needs a per-url promise registry so the second caller awaits the first, which also removes the
duplicate request.*

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
| `test-and-lint.yml` | push/PR to `main`, or called | Nine jobs — see below |
| `publish-search.yml` | tag `search-**` | test-and-lint → `build:wasm` → npm publish `packages/search/package.json` |
| `publish-netgrep.yml` | tag `netgrep-**` | test-and-lint → `build:wasm` → `build` → npm publish `packages/netgrep/package.json` |

`test-and-lint.yml` is **one job per failure mode**, so the check that goes red names the command that
failed:

```
wasm ──┬── test-browser ──┐
       ├── typecheck ─────┤
       └── package ───────┤
                          ├── ci   (aggregate; the check to require)
lint-js ──────────────────┤
lint-rust ────────────────┤
test-rust ────────────────┤
test-unit ────────────────┘
```

`wasm` runs `build:wasm` and uploads `packages/search/pkg` as an artefact, so the three jobs that need it
download it instead of recompiling the ripgrep tree three times. The four that need nothing from Rust — Biome
and the unit suite, which mocks the engine — do not wait for it. Setup is shared through the composite
actions in `.github/actions/`. See
[decision 0015](decisions/0015-one-ci-job-per-failure-mode.md).

Both publish workflows use `greater-version-only: true`, so a forgotten version bump makes the publish a
silent no-op rather than a loud failure. They rebuild the WASM rather than take the tested artefact, on
purpose — the trade-off is noted in `publish-search.yml`.

`verify:pack` exists because every other check inspects the working tree, while the tarball is the only
artefact a consumer ever receives. That gap is how a published package containing no WASM became possible.

Workflows read the pinned versions from `rust-toolchain.toml` and `.node-version` rather than restating them,
so local and CI cannot drift the way they once did. `.github/actions/rust` parses the channel, targets and
components straight out of `rust-toolchain.toml`.

---

## Testing strategy

| Suite | Runner | What it covers |
|---|---|---|
| `Netgrep.spec.ts` | Vitest in **Node**, 30 tests | Orchestration only — `fetch` **and** `@netgrep/search` are mocked. Result shape, metadata, abort plumbing, error capture and serialisation, config defaults, cache scope and accumulation, and all three public methods including `searchBatchWithCallback`. |
| `Netgrep.integration.spec.ts` | Vitest in **headless Chromium** (Playwright), 28 tests | **The real engine through the real streaming loop, in a real browser.** Only `fetch` is faked, and only to remove the network: bytes still travel through a real `ReadableStream`, still arrive chunked, still get matched by the compiled `search_bytes`. |
| `packages/search/tests/search.rs` | `cargo test`, native, 25 tests | `search_bytes` as pure Rust — bytes in, bool out. Regex features, smart case, line semantics, encoding and BOM handling, binary detection. No browser involved. |
| `scripts/verify-pack.mjs` | Node, in CI | The published tarballs: required files present, no `workspace:` range survived packing, no version drift. |

The split between the first three is deliberate: anything that depends only on the bytes is cheapest to pin
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

The example is a manual smoke test. It runs against local workspace source, so it is honest — but it is not
automated and does not run in CI.
