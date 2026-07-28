# Architecture

How netgrep is built and why it behaves the way it does. For *decisions* and their rationale see
[`decisions/`](decisions/). For how to work in the repo see [`../AGENTS.md`](../AGENTS.md).

---

## Scope

netgrep answers one question: **does `pattern` occur in the file at `url`?** The answer is a `boolean`.
No line numbers, no byte offsets, no matched text, no match counts.

The distinguishing property is *when* it answers: the search runs against each chunk of the HTTP response
**as it arrives**, so a match in the first kilobyte resolves without waiting for the remaining megabytes.

It is a browser-targeted library. It requires `fetch` with a readable response body stream, and a bundler
capable of loading WebAssembly asynchronously.

**Non-goals:** indexing, ranking, snippets, highlighting, Node.js support, filesystem search, a CLI.

---

## The three packages

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/example  — webpack 5 demo, not published                │
│   plain JS, ~60 .txt files, debounced input → searchBatch        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ imports (from npm — see AGENTS.md §2)
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/netgrep  — @netgrep/netgrep (TypeScript, ESM)           │
│   streaming, batching, in-memory cache, abort, error shaping     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ imports search_bytes (from npm)
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/search   — @netgrep/search (Rust → WASM)                │
│   search_bytes(&[u8], &str) -> bool                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ cargo git dependency, tag 13.0.0-wasm
┌───────────────────────────▼─────────────────────────────────────┐
│ github.com/dgopsq/ripgrep — fork of ripgrep 13.0.0               │
│   grep meta-crate: grep-regex, grep-searcher, grep-printer, …    │
└─────────────────────────────────────────────────────────────────┘
```

The arrows are *package* dependencies resolved from npm, **not** local source links. See
[`../AGENTS.md` §2](../AGENTS.md#2--read-this-before-you-edit-anything).

---

## The Rust core — `packages/search`

`src/lib.rs` is 48 lines and exposes exactly one `#[wasm_bindgen]` function:

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

`wee_alloc` is the global allocator, chosen to keep the WASM binary small. The release profile uses
`lto = true` and `opt-level = 's'`. The resulting `index_bg.wasm` is **~1.0 MB** — every consumer of the
library downloads that.

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

All verified by reading the source at the versions in this repo. All present in the published
`@netgrep/netgrep@0.1.5`. **Documented, not fixed** — the project is in maintenance mode, and caveats 1 and 2
interact: fixing either one naively reintroduces or worsens the other.

### 1. Chunk-boundary false negatives — `Netgrep.ts:71`

`search_bytes(u8Array, pattern)` is called with **one chunk at a time**, and chunks are never overlapped or
joined before searching. A pattern that straddles the boundary between two `fetch` chunks is never seen by the
matcher.

Silent wrong answer: `result: false` for a file that does contain the pattern. Whether it triggers depends on
network chunking, so it is non-deterministic across runs and effectively untestable by luck.

*Any fix requires retaining a tail buffer of at least `pattern.length - 1` bytes (more for regex patterns,
where the maximum match length is not knowable from the pattern alone) and prepending it to the next chunk.*

### 2. Poisoned partial cache — `Netgrep.ts:76`, `:80`, `:89-91`

`upsertMemoryCache` appends each chunk as it arrives (`:76`), but the loop **resolves and stops reading the
moment a chunk matches** (`:80`). The cache is then left holding only the *prefix* of the file downloaded so
far, with no marker that it is incomplete.

A later search on the same URL for a different pattern takes the cache-hit path (`:89-91`) and searches that
truncated prefix — returning `false` for text that was never downloaded.

Reproduction: search a large file for a term near the top (populates a short prefix), then search the same URL
for a term near the bottom → `false`.

*Any fix needs a completeness flag per cache entry, so partial entries are only ever used to resume, never to
answer.*

### 3. Unbounded cache growth — `Netgrep.ts:198`

The cache is a plain `Record<string, Uint8Array>` with no eviction, no size cap and no TTL. It retains the
full bytes of every file searched for the lifetime of the `Netgrep` instance. `upsertMemoryCache` also
reallocates and copies the whole accumulated buffer **per chunk**, making cache population O(n²) in bytes.

### 4. Regex recompiled per chunk — `lib.rs:13-17`

`search_bytes` builds a fresh `RegexMatcher` on **every call**, i.e. once per network chunk per file. Regex
compilation is the expensive part of a small search; this discards it every time.

### 5. Panic on invalid pattern — `lib.rs:17`

`.build(pattern).unwrap()` panics inside WASM if the pattern is not valid regex. Since patterns typically come
straight from a user-facing search box, a stray `(` or `[` aborts the WASM instance rather than surfacing a
catchable JavaScript error.

### 6. No completion signal from `searchBatchWithCallback`

It returns `void` and starts every search eagerly with no concurrency limit. Callers cannot await it, cannot
detect completion, and a batch of N URLs opens N simultaneous connections.

---

## Build & release pipeline

### `packages/search` (Rust → WASM)

```
wasm-pack build --scope netgrep --out-name index --release
  → packages/search/pkg/{index.js, index_bg.js, index_bg.wasm, index.d.ts, package.json}
node scripts/post_build.js
  → injects "type": "module" into pkg/package.json
```

`post_build.js` exists because `wasm-pack` does not emit `"type": "module"`, without which the generated ESM
is misinterpreted by Node and some bundlers.

### `packages/netgrep` (TypeScript)

`@nrwl/js:tsc` compiles to `packages/netgrep/dist/`, copying `README.md` and synthesising `main`, `typings`
and a `tslib` peer dependency into the emitted `package.json`.

### CI — `.github/workflows/`

| Workflow | Trigger | Action |
|---|---|---|
| `test-and-lint.yml` | push/PR to `main`, or called | `nx run-many --target=lint`, then `--target=test` |
| `publish-search.yml` | tag `search-**` | test-and-lint → `nx build search` → npm publish `pkg/package.json` |
| `publish-netgrep.yml` | tag `netgrep-**` | test-and-lint → `nx build netgrep` → npm publish `dist/package.json` |

Both publish workflows use `greater-version-only: true`, so the version in the respective manifest must be
bumped by hand before tagging.

**CI is currently broken.** Both Rust-touching workflows install `toolchain: stable`, and current stable fails
on `wasm-bindgen 0.2.82` (see [`../AGENTS.md` §3](../AGENTS.md#3-toolchain)). They also pin
`actions/checkout@v2` and the archived `actions-rs/toolchain`. Tracked in [`BACKLOG.md`](BACKLOG.md).

---

## Testing strategy

| Suite | Runner | What it covers |
|---|---|---|
| `packages/netgrep/src/lib/Netgrep.spec.ts` | jest + jsdom, 7 tests | Orchestration only — `fetch` **and** `@netgrep/search` are both mocked. Verifies result shape, error capture, and that a cache hit avoids a second `fetch`. |
| `packages/search/tests/search.rs` | `wasm-bindgen-test` in headless Chrome, 2 tests | Real matching behaviour: a literal match and a smart-case match. |

Because the TypeScript suite mocks the WASM module, **nothing in CI exercises the real engine through the
TypeScript API.** The chunk-boundary bug (caveat 1) is invisible to both suites by construction.

The example app is a demo and verifies nothing — it runs against published npm packages.
