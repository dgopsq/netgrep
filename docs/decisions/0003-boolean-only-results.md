# 0003 — Return a boolean, not match details

**Status:** Accepted, then **amended by [0020](0020-the-matching-line.md)** (2026-07-30), which added the
first matching line as an opt-in, and **again by [0027](0027-streaming-matching-lines.md)** (2026-08-06).
There is no longer a default to be a boolean: there are two functions, and `matches()` is the one whose answer
is a boolean. The reasoning below still explains why that answer is worth having and why it is cheap — it is
just no longer the only answer netgrep can give. Read 0027 for what is returned today.

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
  pass for the snippet case. ~~Highlighting, ranking and match counts are still refused, and 0020 says why.~~
  **(2026-08-07: highlighting is no longer refused. [0022](0022-capture-ranges.md) shipped each match's
  position within the line on request, and [0027](0027-streaming-matching-lines.md) made those positions
  unconditional — a caller highlights by slicing the line at the offsets the engine gives them. Ranking and
  match counts are still refused.)**
- Because only membership is needed, the searcher can stop at the first match. Combined with
  [0002](0002-search-while-downloading.md), that is what makes early resolution possible at all.
- ~~`MemSink` counting rather than short-circuiting is slightly wasteful — `Sink::matched` returns `Ok(true)`
  ("keep searching") when it could return `Ok(false)` to stop at the first hit within a chunk.~~ **Done
  2026-07-29** (BACKLOG 13); it returns `Ok(false)`. Worth 16.4ms → 1.3ms over 800 16 KB chunks in which
  every line matches, and nothing at all where matches are rare.
- The richer output would require designing a serialisation format across the boundary. Out of scope while the
  project is in maintenance mode.

---

## Amendment (2026-08-06) — the boolean is a function, not a default

[0027](0027-streaming-matching-lines.md) replaced the `Netgrep` class with `grep()` and `matches()`, and this
PR deleted the class. The decision recorded above survives inside `matches()`, which is still
`search_bytes(chunk, pattern) -> bool` and still stops at the first hit. What stops being true is that the
boolean is the *default* — it is one of two answers a caller picks between.

*The target use case — "which of these documents mention X?" — needs only membership* is no longer the whole
story. It is the use case `matches()` serves, and it is still a real one; 0025 named a second, the viewer,
which needs every matching line and where each one is, and `grep()` serves that.

*Minimal WASM/JS boundary traffic: one pointer, one length, one bool* is exactly true of `matches()` today,
and is why it survived as its own entry point rather than becoming `grep()` with a `break`. A caller that only
wants membership still allocates nothing and copies no string out of WebAssembly.

*Because only membership is needed, the searcher can stop at the first match* is retracted by 0027: early exit
stops being a library policy and becomes the caller's choice. `grep()`'s `break` and `matches()`' `return true`
are the two forms of it, and the mechanism underneath is the one this record described.

*The richer output would require designing a serialisation format across the boundary. Out of scope while the
project is in maintenance mode.* The format exists. It is `BlockHits { text, table }` — the block's matching
lines joined into one string plus a flat `Uint32Array` of line numbers, offsets and lengths — designed in 0027
precisely so that nothing is materialised eagerly. The cost this bullet anticipated was real and was paid, not
avoided.

One line above quotes a README sentence the README no longer contains: *"At the moment Netgrep is just going
to tell whether a pattern is present on a remote file."* It went with 0025's repositioning. Naming that here
rather than editing the quotation, because the quotation is what the record was written against.
