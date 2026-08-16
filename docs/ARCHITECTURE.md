# Architecture

How netgrep is built and why it behaves the way it does. For *decisions* and their rationale see
[`decisions/`](decisions/). For how to work in the repo see [`../AGENTS.md`](../AGENTS.md).

---

## Scope

netgrep answers two questions about the file at `url`. **Does `pattern` occur in it?** — `matches`, a
`boolean`. **Which lines match?** — `grep`, every matching line as it is found, each carrying its
file-absolute line number and each match's position within the line. No file-wide byte offsets, no match
counts, no context lines, no ranking; [decision 0020](decisions/0020-the-matching-line.md) records why the
line was worth adding, [0022](decisions/0022-capture-ranges.md) why positions within it are, and
[0027](decisions/0027-streaming-matching-lines.md) why enumeration and line numbers stopped being refused,
along with why the rest stay refused.

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

It is not the only gate, but the second one is now the caller's to open. `grep` and `matches` both take a
`fetch` option handed to the request unchanged, so an `Authorization` header, an API key or
`credentials: 'include'` are all reachable — and a file behind a login is searchable when its host
cooperates, which for credentials means `Access-Control-Allow-Credentials` and a named origin rather than
`*`.

**Non-goals:** indexing, ranking, positions in the *file*, filesystem search, a CLI.
(Positions within a returned line are in scope since 0022 and line numbers since 0027; file-wide byte
offsets are not.)

**The positioning is deliberate** — [decision 0025](decisions/0025-streaming-grep-over-http.md).
netgrep is grep over HTTP: a regex engine answering a question about a remote file in constant memory,
before the download finishes. Against a large set of files, or one you can preprocess, a prebuilt index wins
on size, speed and capability; netgrep's ground is a file you do not control, cannot preprocess, and have no
shell on the machine that holds the file. That is also why the correctness caveats below are documented
rather than hidden, and why the API has widened exactly three times in four years:
[0020](decisions/0020-the-matching-line.md)'s matching line,
[0022](decisions/0022-capture-ranges.md)'s positions within it, and
[0027](decisions/0027-streaming-matching-lines.md)'s enumeration. The third **narrowed while it widened** —
`grep` and `matches` replaced a class, its two batch methods and the `capture` option, so the surface is
smaller after it than before.

---

## The three packages

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/example  — the public demo, deployed to GitHub Pages   │
│   Vite + React + Tailwind, one of four generated logs           │
│   (up to 240 MB), debounced input → one grep() at a time        │
│   (decisions 0017, 0026, 0028)                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ workspace:*
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/netgrep  — @netgrep/netgrep (TypeScript, ESM)          │
│   streaming, abort — retains nothing, reshapes no error         │
│   awaits init() once, then searches each block of whole lines   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ workspace:*
┌───────────────────────────▼─────────────────────────────────────┐
│ packages/search   — @netgrep/search (Rust → WASM)               │
│   search_bytes(&[u8], &str) -> Result<bool, JsError>            │
│   search_block(&[u8], &str, usize) -> Result<BlockHits, JsError>│
│   wasm-pack `web` target: new URL(…, import.meta.url)           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ crates.io
┌───────────────────────────▼─────────────────────────────────────┐
│ grep-matcher · grep-regex · grep-searcher   (upstream ripgrep)  │
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

`src/lib.rs` is ~520 lines, most of them comment, and exposes two `#[wasm_bindgen]` functions:

```rust
pub fn search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, JsError>
pub fn search_block(chunk: &[u8], pattern: &str, max_line_bytes: usize)
    -> Result<BlockHits, JsError>
```

wasm-bindgen unwraps those `Result`s, so the TypeScript a consumer sees is
`search_bytes(chunk: Uint8Array, pattern: string): boolean` and
`search_block(chunk: Uint8Array, pattern: string, max_line_bytes: number): BlockHits`, the carrier described
below — both simply **throw** on a pattern the regex engine will not accept, rather than trapping the instance
as they did until 2026.

The cheaper one stays free. `matches.ts` calls `search_bytes` outright, so a caller who wants only membership
allocates nothing, decodes nothing and copies no string out of WebAssembly. `grep.ts` calls both: `search_bytes`
once with an empty chunk, to compile the pattern before the connection opens, and then `search_block` per block.

Both share one compiled-matcher memo and one searcher-building function, `build_searcher`. Its **binary
detection is fixed for every caller**, deliberately: `BinaryDetection::none()` decides whether a block is
abandoned before a byte of it is searched, so letting that vary by caller would change the answer itself, not
merely what accompanies it (caveat 5, below). Its **line-number counting is not fixed** —
`build_searcher(line_numbers: bool)` takes that as a parameter, because counting terminators changes only cost,
never the answer: `search_bytes` passes `false`, reporting no line number, and `search_block` passes `true`,
because the streaming loop that will consume it needs one per hit.

The ranges are computed only after the search has ended, by running the same compiled matcher over the kept
line — bounded by the line, off the hot path, and once per hit rather than once per call. Conversion to UTF-16
code units happens against the decoded, truncated string, since a byte offset into the input would be wrong
wherever lossy decoding substituted `U+FFFD`. See [decision 0022](decisions/0022-capture-ranges.md).

The two differ in when they stop: `search_bytes`' `MemSink` returns `Ok(false)` from `matched` to stop at the
first hit, while `search_block`'s `BlockSink` returns `Ok(true)` and keeps going, collecting every matching line
in the block. Each hit carries a **1-based, block-relative** line number — turning that into a file-absolute one
is `grep`'s job, by advancing a running base per block — plus the ranges of every match within the line.

The result crosses the WASM boundary as `BlockHits { text: String, table: Vec<u32> }` rather than a vector of
per-hit structs. `serde-wasm-bindgen` would build every JavaScript object eagerly at marshalling time, and a
common token in a 240 MB log produces hundreds of thousands of hits live at once — exactly the allocation
pressure the constant-memory claim ([decision 0025](decisions/0025-streaming-grep-over-http.md)) cannot afford.
Instead exactly two values cross the boundary per block, whatever the hit count: `text` is every matching line,
terminator-stripped, joined by `\n` in hit order — unambiguous by construction, since a match can never span a
`\n` — and `table` is `[hitCount, linesInBlock]` followed by one record per hit, `[lineNumber, nRanges, start,
end, …]`. `nRanges` counts **pairs**, so a hit's record is `2 + nRanges * 2` words long.

**`grep` in `packages/netgrep` is the only caller.** It advances a running file-absolute line base by
each block's `linesInBlock` rather than counting terminators itself — that count would mean walking
every byte of the file again, in the slowest language on the path.

Per call the engine:

1. Reuses the **last compiled matcher** if the pattern is unchanged, and otherwise compiles a new one with
   `crlf(true)`, `multi_line(true)`, `line_terminator(b'\n')` and **`case_smart(true)`** — smart case is
   hardcoded on and not configurable, and `crlf`/`multi_line` make `^`/`$` CRLF-aware without moving the line
   terminator off `\n` (item 6, below). A lowercase pattern matches case-insensitively; a pattern containing an
   uppercase character matches case-sensitively. netgrep calls this once per network chunk with the same
   pattern every time, so the cache hits on every chunk after the first; compilation was 97–99% of the cost
   before it existed. Failed compiles are cached alongside successful ones. See
   [decision 0016](decisions/0016-compiled-matcher-memo.md).
2. Builds a `Searcher` with `BinaryDetection::none()`, and `line_number(false)` for `search_bytes` or
   `line_number(true)` for `search_block`, which needs a line number per hit; see above.
3. Runs `search_slice` into a `Sink` — `MemSink` for `search_bytes`, which does nothing but record that a match
   happened and stop; `BlockSink` for `search_block`, which keeps every matching line and its number. Both are
   minimal implementations, written because ripgrep's real sinks write to stdout, which does not exist in WASM.
4. Returns the boolean, or the flattened `BlockHits`.

Each export is split in two: `try_search_bytes` and `try_search_block` are plain Rust returning
`Result<_, String>` — with `try_encode_block` flattening a block's hits into the carrier — and the
`#[wasm_bindgen]` functions are two-line wrappers mapping that to a `JsError`. The split is not tidiness:
`JsError` is a wasm-bindgen import that panics if constructed on a native target, and the Rust tests run
natively.

The default Rust allocator is used. `wee_alloc` was the global allocator until 2026; it was removed once
measurement showed it saved 6,839 bytes — 0.6% — which no longer justified an unmaintained dependency with a
known leak in a published package's hot path. See [decision 0008](decisions/0008-wee-alloc.md).

The release profile (`lto`, `opt-level = 's'`, `codegen-units = 1`, `panic = 'abort'`) lives in the
**workspace root** `Cargo.toml`. It has to: Cargo silently ignores `[profile.*]` in a member package, and for
most of this project's life the size-tuned profile sat in `packages/search/Cargo.toml` doing nothing at all.

`index_bg.wasm` is **~1.17 MB** (1,169,038 bytes; ~500 KB gzipped) — every consumer downloads it. Roughly a
third is `regex-automata`'s DFA and Unicode tables.

---

## The TypeScript wrapper — `packages/netgrep`

The public surface is `grep` and `matches`. `src/lib/data/` holds four types, one per file.

`src/lib/splitAtLastLine.ts` sits beside them and is **not** re-exported by `index.ts` — `index.ts`
star-exports `./lib/grep.js` and `./lib/matches.js`, type-exports the four data types, and nothing else, so
anything exported from either entry-point file would become public API, and the two entry points share enough
plumbing for that to matter. It is a separate module rather than a private function so that its edge cases can
be unit-tested directly, with a tiny cap, instead of only through a >64 KB fixture in a browser.

### Public API

| Function | Returns | Semantics |
|---|---|---|
| `grep(url, pattern, options?)` | `AsyncGenerator<NetgrepHit>` | Every matching line, as it is found, with a file-absolute line number and each match's position within the line. |
| `matches(url, pattern, options?)` | `Promise<boolean>` | Whether the file contains a match. The first hit ends the transfer; an absence costs the whole file. |

`grep` takes `GrepOptions { fetch, maxLineBytes, onProgress }`; `matches` takes the same without
`maxLineBytes`, having no line to bound. Both are per-call, and they are all the configuration there is — the
library retains nothing between searches, so there is nothing else to configure
([0024](decisions/0024-remove-the-in-memory-cache.md)). There is no top-level `signal` on either: it lives in
`fetch`, where it is already a standard `RequestInit` key, and a second one would need a documented precedence
rule against it to save eight characters.

That option is what makes either cancellable at all past the easy case. Breaking out of `grep`'s `for
await` cancels the transfer, but `grep` yields only on a hit — so over a stretch of file that matches nothing
the loop body never runs and there is no `break` to take, and `.return()` on a generator parked in an `await`
waits for a `yield` that never comes. `matches` does not even offer that much: it returns one `Promise` and
exposes no loop, so a signal is not its fallback but its only mechanism. An `AbortSignal` in `options.fetch`
needs neither a loop nor a hit.

### The streaming loop

```
grep(url, pattern)
  │
  ├─ await wasmReady            ← init() started once at module load
  ├─ search_bytes([], pattern)  ← compiles the pattern before the connection
  │
  └─ for await (block of streamBlocks(url, options))
       │
       ├─ streamBlocks: fetch(url, options?.fetch) → res.body.getReader()
       │    ├─ read() → { value, done }
       │    ├─ done → yield the held-back tail, if it has not gone out already
       │    ├─ splitAtLastLine(tail ++ value, 64 KB) → whole lines, tail held back
       │    └─ finally → reader.cancel()   ← break, throw and return all land
       │                                     here — but a break only exists to
       │                                     take once a hit has been yielded
       │
       └─ search_block(block, pattern, maxLineBytes)
            ├─ { text, table } ── two crossings per block, whatever the hit count
            ├─ free the carrier
            ├─ decodeBlock walks it with a cursor → yield one hit at a time
            └─ linesBefore += table[1]
```

Five things about that shape are load-bearing:

- **The engine only ever sees whole lines** ([decision 0018](decisions/0018-line-oriented-tail-buffer.md)). A
  match cannot span a `\n`, so the incomplete trailing line is the exact carry-over between chunks — which is
  why a boundary cannot hide a match, and why it cannot fake a line start for `^` or a line end for `$`
  either. `splitAtLastLine` falls back to a 64 KB byte window when a line outgrows the ceiling, which is the
  one case where a match can still be lost (caveat 1).
- **Nothing is retained between reads.** One chunk plus the incomplete line at its end, bounded at 64 KB,
  however long the file is. There is no accumulation and no cache
  ([0024](decisions/0024-remove-the-in-memory-cache.md)) — which is what makes the memory cost independent of
  the response size.
- **The running line base comes from the engine, not from counting `\n` in JavaScript.** `search_block`
  already counts terminators to answer with a line number per hit; walking the block again in TypeScript
  to arrive at the same number would double the cost for no more correctness.
- **The walk is lazy.** `decodeBlock` is a generator over `table`, so a block with half a million hits does
  not materialise half a million `NetgrepHit` objects before the caller sees the first one — the same
  allocation pressure `BlockHits` crossing the WASM boundary as two flat values, rather than one per hit,
  is built to avoid.
- **The generator suspends at `yield`.** A consumer that is slow to resume `grep`'s `for await` leaves the
  loop parked there, which leaves `streamBlocks`' `read()` uncalled — backpressure on the socket with no
  pause logic anywhere in this code.

`matches` is the same loop with the block step replaced:

```
matches(url, pattern)
  │
  ├─ await wasmReady
  ├─ search_bytes([], pattern)   ← compiles the pattern before the connection
  │
  └─ for await (block of streamBlocks(url, options))
       └─ search_bytes(block, pattern)
            └─ true → return    ← leaves the loop, so streamBlocks' finally
                                  cancels the reader and ends the transfer
```

It shares `streamBlocks` verbatim, which is the point of that file: the correctness-critical part — the tail,
the whole-line invariant, the cancel — has one implementation and one test suite, and the public API in its
entirety is two entry points differing only in what they do per block. `matches` never calls `search_block`,
so no line is copied out of WebAssembly and no terminator is counted; that is why it is cheaper than `grep`
rather than merely narrower.

---

## Known limitations & correctness caveats

All verified against the source in this repository, and every one still open is **pinned by a test** — in
`grep.integration.spec.ts` and `matches.integration.spec.ts`, each of which ends with a `documented defects`
block, and for the ones that live in the engine also in the `documented_defects` module of
`packages/search/tests/search.rs`. Those tests assert the current, wrong behaviour; the ones marked
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
Caveats 5 and 6 were both fixed on 2026-08-05, and what replaced each is described below rather than removed,
because the trade each made is a caveat worth publishing rather than a closed matter. Caveat 6's fix left a new
one behind — reviewed, not designed — so caveat **8** is new rather than renumbered: it gets its own heading
because it is still open, unlike the fix it was found alongside.

### 1. Chunk-boundary false negatives — FIXED, with a residual

`search_bytes` used to be called with **one chunk at a time**, never overlapped or joined, so a pattern
straddling the boundary between two `fetch` chunks was never seen by the matcher. A silent wrong answer whose
trigger depended on how the network split the response.

`streamBlocks` now retains the **incomplete trailing line** of everything read so far and prepends it to the
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
> window's first byte, because a windowed tail starts mid-line and the engine cannot be told so; and a
> `NetgrepHit`'s `line` begins at that same arbitrary byte, so it is a fragment rather than a line — and its
> `ranges` can come back empty, since the fragment need not contain the match. Returning `null` for such a
> line was rejected in [decision 0020](decisions/0020-the-matching-line.md). All three need a line longer
> than 64 KB, so all three are unreachable in hand-written text, and in the demo's log files too: 408.6 MB of
> real log lines whose longest, across all four sources, is 387 bytes. Size is not what reaches this — line
> length is. **The demo's line-number gutter now rests on that 387 bytes**: a future seed carrying a 64 KB
> line would make every number in it a guess, silently, with nothing on the page or in CI to catch it — so
> this is a constraint on the seeds, not on the page (see [decision 0028](decisions/0028-demo-as-live-grep.md)).
>
> **`grep` inherits the same window and adds two consequences of its own**, pinned as `documented defects`
> in `grep.integration.spec.ts` rather than fixed. A hit inside such a line is **yielded more than once** —
> the windowed tail is searched as the whole of one block and again as the head of the next, and each pass
> reports it. And the running line base **gains a line at every window slide**, drifting every line number
> reported after the over-long line, not only its own. Both are deliberate: suppressing the repeat would
> mean not yielding it at all if the stream happened to end inside the window, and a lost hit is worse for
> a grep than a repeated one; and the windowed tail, once it has been searched, is never re-searched at
> EOF, so there is no later pass that could correct the count.
>
> **`matches` inherits the same window and adds nothing**, which is exactly why it is worth naming: the two
> failures above arrive as a plain `true` or `false`, with nothing beside them a caller could inspect. A
> match spanning more than 64 KB of one line answers `false`, and `^` answers `true` over a file no line of
> which begins that way — a claimed match that is not in the file, reported identically to a real one.
> Pinned as `documented defects` in `matches.integration.spec.ts`, each beside a control that keeps the line
> under the ceiling.

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

### 4. No completion signal from `searchBatchWithCallback` — CLOSED BY REMOVAL

It returned `void` and started every search eagerly with no concurrency limit: callers could not await it, could
not detect completion, and a batch of N URLs opened N simultaneous connections. The method and the class that
carried it were deleted with [decision 0027](decisions/0027-streaming-matching-lines.md)'s API — `grep` and
`matches` are one url each and hand back a value the caller drives, so there is no batch whose end could go
unsignalled, and concurrency is the caller's to limit. Kept as a heading because caveats are referred to here by
number.

### 5. One NUL byte discarded the whole searched block — FIXED

`BinaryDetection::quit(b'\x00')` did not stop *at* the NUL — it abandoned everything it was handed, so a match
was dropped even when it occurred before the NUL, and even on an earlier line. `build_searcher` now uses
`BinaryDetection::none()`, which searches every byte as text instead.

Quitting on binary input was a reasonable ripgrep default; the defect was that a boolean API could not
distinguish "binary, not searched" from "no match" — and a line-returning API did not help either, since a
discarded block reported no hit and therefore no line.

The trade is real and is published rather than hidden: nothing now declines to search binary input, so a
pattern occurring inside a `.png` is reported like any other match, and the line `grep` yields for it is
whatever those bytes decode to. Listed in [`guide/caveats.data.json`](guide/caveats.data.json) as `no-binary-detection`,
`kind: "by-design"`. Decision 0018's incidental narrowing — a NUL landing in the held-back partial line let an
earlier match survive by accident, rather than by design — stopped being incidental: every match now survives,
for the ordinary reason, and that case is still pinned so the two are not told apart by chance. Closed as
BACKLOG 3f; see the `# Done` table in [`BACKLOG.md`](BACKLOG.md).

### 6. `$` did not match on CRLF input — FIXED

The searcher was given `line_terminator(Some(b'\n'))` with no `.crlf(true)` on the matcher, so on a
Windows-authored file the `\r` was the last character of the line and `$` sat behind it. `needle$` matched
`"needle\n"` and did **not** match `"needle\r\n"`, while plain `needle` matched both. `^` was unaffected — the
CR is at the other end.

Silent, and it depended on who wrote the file rather than on anything the caller did. It was not the one-line
fix this entry expected: `RegexMatcherBuilder::crlf(true)` alone leaves a bare `$` compiling unchanged, because
`$` parses to the same AST node as `(?m)$` and `regex-syntax` only picks the CRLF-aware anchor over the
absolute end-of-haystack one when multi-line mode is on — `.multi_line(true)` had to go alongside it. Neither
call touches the matcher's line terminator, which stays `\n`, so the invariant `test_a_match_cannot_span_a_line_terminator`
pins is undisturbed.

The fix widened the anchors further than the entry anticipated, which is caveat 8, below — that side effect is
still open, unlike this one. Item 6 itself is closed as BACKLOG 17; see the `# Done` table in
[`BACKLOG.md`](BACKLOG.md).

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
in `matches.integration.spec.ts` — an ordinary assertion, not a defect one.

### 8. `^`/`$` anchor to a bare `\r`, but the line splitter does not

A side effect of fixing caveat 6, found by review rather than by design. `crlf(true)` — the fix for `$` on CRLF
input — enables the regex engine's CRLF-aware anchors, and those treat a lone `\r` as a line boundary too, not
only a `\r\n` pair. The line splitter (`grep-searcher`'s own line-finding, unrelated to the matcher's anchor
config) disagrees: it still only ever breaks a chunk into lines on `\n`. So on input using bare CR line
endings — old Mac text, or log output using `\r` to overwrite a progress line in place — the anchors and the
yielded line describe different boundaries for the same bytes:

```
"foo\rbar\n" ~ "foo$"        -> matches       # was false before caveat 6 was fixed
"foo\rbar\n" ~ "^bar"        -> matches       # was false before caveat 6 was fixed
"foo\rbar\n" ~ grep, "foo$"  -> line: "foo\rbar"   # NOT "foo", though "foo$" just matched
```

Whether it matched is correct either way — the anchors did match. What is surprising is the hit: a caller whose
pattern matched on the strength of `$` reasonably expects the yielded line to end where `$` matched, and it does
not.

A fix would mean either making the line splitter agree with the anchors — teaching it to also break on a bare
`\r`, which `grep-searcher` does not expose as a configuration and would mean patching it, reopening the fork
[decision 0001](decisions/0001-fork-ripgrep-for-wasm.md) removed — or making the anchors agree with the
splitter, which is not a knob `crlf(true)` offers separately from its CRLF behaviour. Bare-CR line endings are
decades obsolete for text files; the progress-bar case is real but the "line" a caller would want back from it
is not obviously well-defined either. Not obviously worth fixing. Published as `bare-cr-anchors` in
[`guide/caveats.data.json`](guide/caveats.data.json), `kind: "defect"`, tracked as backlog item **25**. Pinned
in the `documented_defects` module of `packages/search/tests/search.rs` and in `grep.integration.spec.ts`.

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
| `streamBlocks.spec.ts` | Vitest in **Node**, 13 tests | The transport in isolation: whole-line blocks, the held-back tail, `onProgress`, request-option passthrough, and that `cancel()` is called on `break` and on `throw`. Mocks `fetch`; no engine at all. |
| `decodeBlock.spec.ts` | Vitest in **Node**, 8 tests | The `text` + `table` walk, against hand-written tables. A pure generator, so no mocks. |
| `grep.spec.ts` | Vitest in **Node**, 11 tests | `grep`'s bookkeeping with `fetch` **and** `@netgrep/search` mocked: the running line base, freeing the carrier, the cap, and that nothing runs before the first `next()`. |
| `matches.spec.ts` | Vitest in **Node**, 10 tests | `matches`' loop with `fetch` **and** `@netgrep/search` mocked: the early return, the full read that proves an absence, pre-flight compilation, and the errors. |
| `resolveMaxLineBytes.spec.ts` | Vitest in **Node**, 6 tests | The per-line cap's default and clamping, in isolation. A pure function, so no mocks. |
| `grep.integration.spec.ts` | Vitest in **headless Chromium** (Playwright), 39 tests | **The real engine through `grep`, in a real browser.** Only `fetch` is faked, and only to remove the network: bytes still travel through a real `ReadableStream` and still arrive chunked. Chunk-size invariance, absolute line numbers, UTF-16 ranges, truncation, cancellation, and the `documented defects` block. |
| `matches.integration.spec.ts` | Vitest in **headless Chromium**, 22 tests | The real engine through `matches`: chunk-size invariance for the boolean, anchors and smart case, that the first hit stops the reads, that concurrent searches of one url each fetch, and the `documented defects` block. |
| `streaming-transport.integration.spec.ts` | Vitest in **headless Chromium**, 5 tests | **The one suite that does not fake `fetch`.** It proves bytes are delivered and searched *before* the response ends, and that an `AbortSignal` stops a real transfer that neither `grep`'s `break` nor anything `matches` offers can reach — see below. |
| `packages/search/tests/search.rs` | `cargo test`, native, 56 tests | The two entry points as pure Rust — bytes in, bool or block-hits out — plus `try_encode_block`, the wire format `search_block` flattens a block's hits into, which `mod encoding` asserts against hand-read tables. Regex features, smart case, line semantics, encoding and BOM handling, binary detection, the compiled-matcher cache, block-hit collection and line numbering, and the UTF-16 offset conversion including its lossy-decoding and truncation edges. No browser involved. |
| `scripts/verify-pack.mjs` | Node, in CI | The published tarballs: required files present, no `workspace:` range survived packing, no version drift. |

The split between the Rust and TypeScript suites is deliberate: anything that depends only on the bytes is cheapest to pin
in Rust, where a failure names the engine; anything about streaming, chunking or aborting belongs in the
TypeScript suites.

**They overlap in several places, and every overlap is deliberate.** Smart case is one — the verdict in
`mod search` and in both integration suites, the ranges it produces in `mod block` and in
`grep.integration.spec.ts` — because it is the behaviour most likely to move silently under a dependency
bump, and knowing *which* layer moved is worth the duplicated assertion. The defect pins for BACKLOG 3c, 3f
and 17 are the others, 17 including its widening to a bare `\r`, which the TypeScript side files under 25
(caveat 8 below). Each of those names a defect whose symptom in a browser is not its symptom in the engine:
a wasm trap poisons the whole module, so only a browser can show that the next call still answers, and only
the browser suite can show a yielded line disagreeing with the anchor that matched it. **A Rust/TypeScript
pair is not a duplicate to be tidied away — and three of these four are defect pins, which nothing may
remove while the behaviour they name could still change silently.**

The integration suite loads **the artefact that actually ships** (`packages/search/pkg`) and instantiates it
through its own real, fetch-based `init()` — the same loader a consumer gets, resolving `index_bg.wasm`
relative to `import.meta.url` over HTTP. There is no separate Node-target build to drift from what consumers
receive, and no `initSync`-from-disk accommodation either: that was a Node limitation, and the loader it hid
is precisely the part that failed silently under Vite in [decision 0005](decisions/0005-esm-only-distribution.md).
Decision [0029](decisions/0029-run-outside-the-browser.md) ships an `initSync`-from-disk boot for Node,
which is not a reversal of that: what was removed was a *test* accommodation, and the objection was that
it left the browser suite exercising a loader no consumer used. The suite still loads `pkg/` through the
real fetch-based `init()` over HTTP, and the Node path is exercised separately by a suite that runs the
built package. Both loaders now ship, and both are now tested by the runtime that receives them — which
is strictly more coverage than the arrangement this paragraph describes, not less.

Why a browser at all, and why Playwright rather than ChromeDriver:
[decision 0013](decisions/0013-playwright-for-browser-tests.md).

**Faking `fetch` costs the suite the one thing the project claims, so one suite does not.** Every other
integration test replaces `fetch` to make chunk boundaries deterministic — which means none of them can say
anything about the network. They establish that netgrep consumes an already-progressive stream
progressively, and assume the stream is progressive in the first place. That assumption is the project's
defining property ([decision 0002](decisions/0002-search-while-downloading.md)) and until now nothing
enforced it.

`streaming-transport.integration.spec.ts` closes that gap with a server that will not finish.
`vitest.drip-server.ts` registers a Vite middleware serving 64 KB, then holding the connection open and
sending nothing more until a release URL is hit. A test reads a match out of those first bytes and only then
releases the rest, so the read can only have succeeded while the response was unfinished — had the browser
buffered the body, the bytes completing it would not yet exist. **Nothing is timed.** There is no sleep and
no threshold to tune: the ordering is enforced by the server refusing to end, which is what makes this a
proof rather than an observation. The 64 KB head is sized past any plausible socket-buffering threshold, so
a failure means what it says; the deadline in the test exists only to turn a hang into a sentence.

The three progressiveness cases hold each other honest, and both directions were confirmed by mutating the
server: make it withhold the head until release — a buffering transport — and the first two fail with their
explanation; make it send the whole body at once and the third fails, since it asserts the tail is *not*
visible early. The remaining two use the same server for the opposite property: a `grep` and a `matches` over
a body that matches nothing are aborted from `onProgress`, and *settling at all* is the assertion, because the
remaining bytes have not been sent and nothing else could end either of them.

`grep.integration.spec.ts` and `matches.integration.spec.ts` each end with a block that deliberately asserts
**incorrect** behaviour, pinning the caveats above so that an unintended change is caught. Read
[`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose) before editing
either. Those blocks have already earned their place: modernizing the ripgrep dependencies silently *fixed*
the `^`-anchoring bug, and nothing else would have noticed.

The example is the public demo at <https://netgrep.diegopasquali.com/>. It runs against local workspace
source, so it is honest, and CI typechecks and builds it — but nothing asserts what it *renders*, so it
establishes no correctness. Its timings measure the network, and since
[decision 0024](decisions/0024-remove-the-in-memory-cache.md) that is true by construction rather than by
configuration — the library retains nothing to answer a second query from. See
[decision 0017](decisions/0017-example-as-hosted-demo.md).

It searches four generated log files — Apache httpd 8.3 MB, ZooKeeper 40.0 MB, Hadoop YARN 120.1 MB and
OpenSSH 240.2 MB, 408.6 MB together — built by `packages/example/scripts/build-logs.mjs` from four committed
~512 KB loghub-2.0 seeds and served as `.txt` so GitHub Pages compresses them. They are **generated
output and gitignored**, so `pnpm dev` and `pnpm build:example` run the generator first. It is repetitive by
construction: each file is one seed tiled to size, so every term in it recurs within the first megabyte except
the four `NETGREP-MARKER-*` lines the generator plants at fixed depths. The page reports **elapsed time and
bytes read, per source** — the byte figure counted by wrapping the demo's own `window.fetch`, since netgrep
exposes no counter and an aborted transfer reports zero to Resource Timing. It is **decompressed file content
rather than traffic**, the logs being served gzipped at ~16×, and is labelled *Scanned* on the page for that
reason. **No memory figure**, because a tab cannot honestly measure one. See
[decision 0026](decisions/0026-demo-as-log-dashboard.md).
