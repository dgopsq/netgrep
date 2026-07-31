# 0003 — Return a boolean, not match details

**Status:** Accepted, then **amended by [0020](0020-the-matching-line.md)** (2026-07-30), which added the
first matching line as an opt-in. The default is still a boolean and the reasoning below still explains why;
what changed is that "and nothing else" became "unless you ask". Read 0020 for what is returned today, and for
the list of match details that remain refused.

## Context

ripgrep's real output path formats matches with line numbers, byte offsets, context lines and colour, via
`grep-printer` writing to stdout. None of that survives the trip to WASM: there is no stdout, and every
formatted byte has to cross the WASM/JS boundary.

The target use case — "which of these documents mention X?" — needs only membership. A search page lists
matching posts; it does not render snippets.

## Decision

`search_bytes(chunk, pattern) -> bool`. Internally `MemSink` implements `grep::searcher::Sink` and does
nothing but record that a match happened; the function returns that flag.

> **Amended (2026-07-29).** `MemSink` counted matches until [0016](0016-compiled-matcher-memo.md); it now
> records a `bool` and stops at the first hit, which is what the *Consequences* below always said it could
> do. The signature also gained a fallible path — `Result<bool, JsError>` in Rust, still
> `(chunk, pattern): boolean` in the generated TypeScript, throwing rather than trapping on an invalid
> pattern. **The answer is still a boolean**, so this record's decision stands unchanged.

The README states this plainly: *"At the moment Netgrep is just going to tell whether a pattern is present on
a remote file."*

## Consequences

- Minimal WASM/JS boundary traffic: one pointer, one length, one bool.
- ~~No snippets, no highlighting, no ranking, no match counts — so netgrep cannot back a results UI that shows
  *where* or *how often* a term appears without a second pass in JavaScript.~~ **Amended 2026-07-30** by
  [0020](0020-the-matching-line.md): the first matching line is available on request, which removes the second
  pass for the snippet case. Highlighting, ranking and match counts are still refused, and 0020 says why.
- Because only membership is needed, the searcher can stop at the first match. Combined with
  [0002](0002-search-while-downloading.md), that is what makes early resolution possible at all.
- ~~`MemSink` counting rather than short-circuiting is slightly wasteful — `Sink::matched` returns `Ok(true)`
  ("keep searching") when it could return `Ok(false)` to stop at the first hit within a chunk.~~ **Done
  2026-07-29** (BACKLOG 13); it returns `Ok(false)`. Worth 16.4ms → 1.3ms over 800 16 KB chunks in which
  every line matches, and nothing at all where matches are rare.
- The richer output would require designing a serialisation format across the boundary. Out of scope while the
  project is in maintenance mode.
