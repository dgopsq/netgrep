# 0003 — Return a boolean, not match details

**Status:** Accepted.

## Context

ripgrep's real output path formats matches with line numbers, byte offsets, context lines and colour, via
`grep-printer` writing to stdout. None of that survives the trip to WASM: there is no stdout, and every
formatted byte has to cross the WASM/JS boundary.

The target use case — "which of these documents mention X?" — needs only membership. A search page lists
matching posts; it does not render snippets.

## Decision

`search_bytes(chunk, pattern) -> bool`. Internally `MemSink` implements `grep::searcher::Sink` and does
nothing but increment a counter; the function returns `match_count > 0`.

The README states this plainly: *"At the moment Netgrep is just going to tell whether a pattern is present on
a remote file."*

## Consequences

- Minimal WASM/JS boundary traffic: one pointer, one length, one bool.
- No snippets, no highlighting, no ranking, no match counts — so netgrep cannot back a results UI that shows
  *where* or *how often* a term appears without a second pass in JavaScript.
- Because only membership is needed, the searcher can stop at the first match. Combined with
  [0002](0002-search-while-downloading.md), that is what makes early resolution possible at all.
- `MemSink` counting rather than short-circuiting is slightly wasteful — `Sink::matched` returns `Ok(true)`
  ("keep searching") when it could return `Ok(false)` to stop at the first hit within a chunk.
- The richer output would require designing a serialisation format across the boundary. Out of scope while the
  project is in maintenance mode.
