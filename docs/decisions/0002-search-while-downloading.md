# 0002 — Search each HTTP chunk as it arrives

**Status:** Accepted. This is the project's defining property.

## Context

The alternative — `await res.text()` then search once — means latency is bounded by the *slowest* file in the
corpus, even when the answer was available in the first kilobyte. For an interactive search box over dozens of
files, that is the difference between feeling instant and feeling broken.

## Decision

Consume the response as a stream (`res.body.getReader()`) and call the WASM matcher on **each chunk as it
arrives**, resolving the promise the moment a chunk matches. See `handleReader` inside `Netgrep.search`.

This is why the matching engine has to be ripgrep rather than a JavaScript regex over the assembled string:
the whole point is to never assemble the string.

## Consequences

**Good:**
- A match near the start of a file resolves without downloading the rest.
- Peak memory stays near one chunk (when caching is disabled).
- Composes with `AbortSignal` for cancel-on-keystroke.

**Costs:**
- ~~**Correctness: patterns straddling a chunk boundary are missed.** Chunks are searched in isolation with no
  overlap retained, so a match spanning the boundary is invisible. Silent false negative, dependent on
  non-deterministic network chunking.~~ **Fixed 2026-07-30**: the streaming loop retains the incomplete
  trailing *line* of each chunk and prepends it to the next, which is exact because a match cannot span a `\n`.
  Early resolution is preserved in full — it simply becomes line-granular rather than chunk-granular. What
  remains is a residual for lines longer than 64 KB; see [0018](0018-line-oriented-tail-buffer.md) and
  `ARCHITECTURE.md` caveat 1.
- ~~The regex is recompiled per chunk (the `RegexMatcherBuilder` in `lib.rs`'s `search_bytes`), discarding the
  most expensive part of the work on every iteration.~~ **Fixed 2026-07-29**: the engine caches the last
  compiled pattern, so chunking no longer multiplies compilation. It was the largest cost this decision
  carried — 97–99% of per-chunk time. See [0016](0016-compiled-matcher-memo.md).
- ~~Resolving early stops *reading* but does not cancel the underlying request, so bytes may keep arriving.~~
  **Fixed 2026-08-01**: the reader is cancelled on a match, which ends the transfer rather than abandoning
  it. Early resolution now saves bandwidth as well as latency.
- ~~Interacts badly with the memory cache — the cache is left holding a partial file.~~ **Fixed 2026-07-30**
  by writing the cache entry only once the stream has drained, so early resolution leaves no entry rather than
  a partial one. See [0006](0006-in-memory-cache.md), [0018](0018-line-oriented-tail-buffer.md) and
  `ARCHITECTURE.md` caveat 2.
- Requires a real streaming `fetch`; there is no fallback path for environments without it.

The boundary bug was the price paid for this design and went unaddressed for years. **The analysis in this
paragraph, which stood here until 2026-07-30, was wrong in an instructive way**, and it is left as written
above the correction because it is the reasoning that kept the bug open: it concluded that the tail must be
"bounded by the maximum possible match length, which for arbitrary regex is not derivable from the pattern and
must therefore be a configured cap."

The bound is not derivable from the *pattern*. It is derivable from the *data*: a match can never span a `\n`,
so the incomplete trailing line is an exact carry-over and no cap is needed for correctness. Looking for the
bound in the wrong place made the fix look like it required a guess, and a guess is what kept it from being
made. See [0018](0018-line-oriented-tail-buffer.md).
