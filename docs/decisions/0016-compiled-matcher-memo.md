# 0016 — Cache the compiled matcher inside Rust, rather than hand a handle to JavaScript

**Status: ACCEPTED (2026-07-29).** Closes [`BACKLOG`](../BACKLOG.md) items **3c**, **12** and **13**, and
records why the design proposed in [issue #17](https://github.com/dgopsq/netgrep/issues/17) was not the one
taken.

## Context

Two problems in `packages/search/src/lib.rs` were the same problem.

`search_bytes` compiled the pattern on **every call**, and `Netgrep.ts` calls it once per `fetch` chunk per
url. A batch over 200 files averaging four chunks each compiled one pattern 800 times and discarded the
result each time — item **12**.

`.build(pattern).unwrap()` **trapped the WASM instance** when the pattern was not valid, surfacing as
`RuntimeError: unreachable`. Patterns come straight from a user's search box, so a stray `(` was routine
input, not a hypothetical — item **3c**, a P1 correctness defect.

Both are fixed by making compilation happen once, somewhere a `Result` can be returned.

## Considered: a compiled matcher handle

Issue #17 proposed exposing the compiled matcher to JavaScript as a `#[wasm_bindgen]` struct:

```ts
const matcher = new Matcher(pattern);   // fallible: compiles once
matcher.search(chunk);                  // reused per chunk
matcher.free();                         // wasm-bindgen owned handle
```

It is the more explicit design — construction-is-fallible becomes visible in the type — and `BACKLOG` item 12
recommended it in as many words. **It was rejected**, for three reasons:

1. **`.free()` becomes `Netgrep.ts`'s problem.** wasm-bindgen handles are not garbage collected. Every exit
   from the streaming loop — resolve-on-match, stream done, fetch rejection, abort — would have to free, in a
   promise-executor-based function with no cleanup discipline today. An abort mid-batch is the easy one to
   miss, and the cost of missing it is a leaked DFA.
2. **It is a breaking change to a package whose entire public surface is one function**, requiring a major
   bump and coordination with the publish-order rule in [`AGENTS.md` §6.5](../../AGENTS.md#6-hard-rules) — to
   buy something a caller never asked for. netgrep's promise is a boolean per url; a lifetime is not part of
   that.
3. **The cache-hit path gets *slower*.** `Netgrep.search` answers from `memoryCache[url]` without fetching.
   There the compile is amortized over exactly one search, so a handle adds construction and teardown to a
   path that previously had neither.

## Decision

Keep the exported surface exactly as it is, and cache inside Rust.

```rust
struct Compiled { pattern: String, matcher: Result<RegexMatcher, String> }

static LAST_COMPILED: RefCell<Option<Compiled>>
```

- **One entry.** ~~Every url in a single `searchBatch` shares one pattern~~ **(2026-08-07: `searchBatch` is
  deleted; every chunk of a single `grep()` or `matches()` call shares one pattern, and so does every call a
  caller runs one pattern over)**, so a single slot hits on every chunk after the first. Two patterns interleaving — a search-as-you-type box whose previous keystroke has not
  finished — thrashes the slot back to the old behaviour plus one string comparison, which is why an LRU
  would be machinery defending a case whose fallback is *no worse than today*.
- **Failures are cached too.** An invalid pattern is what a search box emits on the way to a valid one;
  without this a stray `(` re-fails once per chunk per url.
- **`thread_local!`, not a `static`.** wasm32 is single-threaded, so this is simply the safe way to spell
  "global" there. Under `cargo test`, which runs a thread per test, it also keeps the tests independent.

`search_bytes` now returns `Result<bool, JsError>`. **The generated TypeScript signature does not change** —
still `(chunk: Uint8Array, pattern: string): boolean`, throwing rather than trapping — so `Netgrep.ts` needed
no edit at all: a throw inside the promise executor rejects the promise, and one inside `handleReader` reaches
the existing `.catch(reject)`.

### The engine is split in two, and the split is load-bearing

```rust
pub fn try_search_bytes(chunk: &[u8], pattern: &str) -> Result<bool, String>   // plain Rust
#[wasm_bindgen] pub fn search_bytes(..) -> Result<bool, JsError>               // two-line wrapper
```

`JsError` is a wasm-bindgen *import*. It compiles on a native target and then panics at runtime with
*"cannot call wasm-bindgen imported functions on non-wasm targets"*. `packages/search/tests/search.rs` runs
natively. Without the split, its two error-path tests would still have passed — by panicking for a reason that
has nothing to do with the pattern being invalid. This is worth knowing before touching the error path again.

The cached error is a `String` rather than `grep_regex::Error` for a duller reason: it is handed out
repeatedly and that type is not `Clone`.

## Measurements

Native, release profile, 800 chunks of prose — the shape of the worked example above. Native rather than
wasm32 because the ratio between compiling and scanning is what matters, and no dependency was added to
measure it (see [`AGENTS.md` §6.2](../../AGENTS.md#6-hard-rules)); the harness was thrown away.

Issue #17 suggested benchmarking against the 67-file Sherlock corpus in `packages/example` instead. That was
**not** what was done, deliberately: the example is a manual demo with a browser and a network in the way, so
it measures the whole pipeline rather than the thing being changed, and it cannot separate a 40× win on
compilation from the milliseconds a chunk spends arriving. The synthetic chunks below isolate the ratio. The
trade is that these numbers say nothing about end-to-end wall-clock, which is dominated by the network and
barely moves.

| pattern | 16 KB chunk | 64 KB chunk |
|---|---|---|
| `needle` | 91.2ms → **2.2ms** | 79.4ms → **9.1ms** |
| `(needle\|thimble\|thread)` | 199.9ms → **2.4ms** | 216.4ms → **7.8ms** |
| `\w+dle\b` | 699.8ms → **2.9ms** | 710.6ms → **6.8ms** |
| `n\p{L}+dle` | 2.9s → **20.6ms** | 3.2s → **49.1ms** |

Compilation was not merely significant; on these workloads it was **97–99% of the total cost**. Item 12 was
filed as a P3 papercut and was closer to the dominant term.

Item **13** was taken in the same pass: `Sink::matched` returned `Ok(true)` — keep searching — and counted
every match, when the only question asked of the count is `> 0`. On chunks where every line matches,
16.4ms → **1.3ms** at 16 KB and 61.9ms → **1.8ms** at 64 KB; on a chunk with one match near the end it is
neutral, as expected. The answer is identical either way, so no test can pin it and measurement is the only
evidence it does anything.

## Considered and not taken: reusing the `Searcher` too

`SearcherBuilder::new()…build()` also runs per chunk. Measured after the two changes above, reusing it is
worth a further **14–22%** on sparse chunks — but of a per-chunk cost that is now ~2µs, against a chunk that
took milliseconds to arrive over the network.

It was left alone because the risk is not symmetric with the matcher's. A `RegexMatcher` is used through
`&self`; a `Searcher` needs `&mut`, so reusing one means carrying **mutable state across calls** in the one
place where stale state would produce a silently wrong boolean rather than a crash — the failure mode this
library can least afford. Not worth 0.5µs. Recorded here so it is not rediscovered and re-measured.

## Consequences

- `lib.rs` grows from ~45 to ~135 lines, most of it comment. The exported surface is unchanged: still one
  function, still a boolean.
- **There is now state in the engine.** Its failure mode — answering with the previous pattern's matcher — is
  a wrong answer, not a crash. Three tests in `search.rs` pin it: a changed pattern is not answered by the old
  matcher; two patterns differing only in case are not confused (smart case is decided at *compile* time, so
  they genuinely need different matchers); and a cached failure does not wedge the valid pattern after it.
- The `CAUTION` block about invalid patterns is **gone from the README** rather than reworded, and
  `AGENTS.md` §7 loses a row.
- Per [0011](0011-tests-that-assert-known-bugs.md) and
  [`AGENTS.md` §2.1](../../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose),
  the three assertions that pinned 3c were inverted in the same change. The integration test now asserts the
  thing that could only ever be asserted in a browser: after an invalid pattern, **the same instance still
  answers correctly**.
- Not fixed, and unaffected: 3a (chunk-boundary false negatives), 3b (poisoned partial cache), 3f (one NUL
  discards the chunk), 17 (`$` on CRLF), 18 (concurrent searches double a cache entry).

---

## Note (2026-08-02) — reason 3's cache-hit path is gone

[Decision 0024](0024-remove-the-in-memory-cache.md) deleted `memoryCache` and the cache-hit path reason 3
above describes; ~~`Netgrep.search` no longer answers from anything but a fetch.~~ **(2026-08-07: the class
is deleted; `grep()` and `matches()` are what answer, and neither answers from anything but a fetch.)** Reasons 1 and 2 are untouched,
and so is the decision they support — a `Matcher` handle would still owe `.free()` discipline and still be a
breaking change to buy nothing a caller asked for. The paragraph above is left as written; this note exists so
a reader re-opening the question does not weigh an argument against a path that no longer exists.
