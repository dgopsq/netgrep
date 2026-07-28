# 0002 — Search each HTTP chunk as it arrives

**Status:** Accepted. This is the project's defining property.

## Context

The alternative — `await res.text()` then search once — means latency is bounded by the *slowest* file in the
corpus, even when the answer was available in the first kilobyte. For an interactive search box over dozens of
files, that is the difference between feeling instant and feeling broken.

## Decision

Consume the response as a stream (`res.body.getReader()`) and call the WASM matcher on **each chunk as it
arrives**, resolving the promise the moment a chunk matches. See `Netgrep.ts:50-104`.

This is why the matching engine has to be ripgrep rather than a JavaScript regex over the assembled string:
the whole point is to never assemble the string.

## Consequences

**Good:**
- A match near the start of a file resolves without downloading the rest.
- Peak memory stays near one chunk (when caching is disabled).
- Composes with `AbortSignal` for cancel-on-keystroke.

**Costs:**
- **Correctness: patterns straddling a chunk boundary are missed.** Chunks are searched in isolation with no
  overlap retained, so a match spanning the boundary is invisible. Silent false negative, dependent on
  non-deterministic network chunking. See `ARCHITECTURE.md` caveat 1.
- The regex is recompiled per chunk (`lib.rs:13-17`), discarding the most expensive part of the work on every
  iteration.
- Resolving early stops *reading* but does not cancel the underlying request, so bytes may keep arriving.
- Interacts badly with the memory cache — the cache is left holding a partial file. See
  [0006](0006-in-memory-cache.md) and `ARCHITECTURE.md` caveat 2.
- Requires a real streaming `fetch`; there is no fallback path for environments without it.

The boundary bug is the price paid for this design and was evidently not addressed. A correct version needs a
retained tail buffer prepended to the next chunk — bounded by the maximum possible match length, which for
arbitrary regex is not derivable from the pattern and must therefore be a configured cap.
