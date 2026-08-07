# 0027 — netgrep streams every matching line, and the boolean becomes a shortcut

**Status: ACCEPTED (2026-08-05).** Amends [0003](0003-boolean-only-results.md),
[0020](0020-the-matching-line.md), [0022](0022-capture-ranges.md) and
[0025](0025-streaming-grep-over-http.md). Cites [0002](0002-search-while-downloading.md) and
[0024](0024-remove-the-in-memory-cache.md) without touching either.

As with 0022, 0023 and 0025, the argument was made in a written design and reviewed before any code was
written. This record ships alone; the seven PRs that implement it land after it, and each carries the
amendment its own change makes true.

## Context

[0025](0025-streaming-grep-over-http.md) repositioned this project as *grep over HTTP* and, in doing so,
named the one case a hostile reviewer conceded was real: when the bytes are moving anyway, because a
human is going to read the file, the search rides along for free. That is a **viewer**. A viewer needs
every matching line and needs to know where each one is.

The API returns one boolean and one line.

[0026](0026-demo-as-log-dashboard.md) then built a log dashboard on that API, and the strain is visible
in the artefact rather than only in the argument. Each of the four panels renders exactly one log line,
because one line is all a panel can be given. `packages/example/src/lib/scan-meter.ts` monkey-patches
the page's own `fetch` to recover a progress figure, because the library exposes none. **The positioning
moved and the API did not.** This record moves the API.

### What is not the reason

The suspicion that started this work was that *"you don't need to download the whole file"* is
dishonest, because a miss reads every byte and misses are common. That is true, and it is not the
argument, and it is recorded here so it is not re-litigated:

- The README claims netgrep *answers the moment a matching line arrives, without waiting for the last
  byte*. That is **latency**, not bandwidth, and 0025 already ranks constant memory above early exit.
  Retiring the bandwidth rider is a two-sentence edit, not grounds to restructure an API.
- Enumerating matches makes the full read **unconditional**. It concedes the complaint rather than
  fixing it. The thing that would fix it is Range requests, and those are not in this record.

The actual gain is that every property becomes unconditional. Today's headline is true only when a match
happens to fall early in the file. After this rewrite, *streams the matching lines as they arrive, in
flat memory, however large the file is* is true of every search, hit or miss.

### One claim in 0025 is wrong, and this record retracts it

0025 states that match counts and all matching lines *"delete early exit outright — you cannot count or
enumerate what you have not read, so each turns every search into a full download and takes constant
memory and the mid-download answer with it."*

The full download is right. The other two are not.

**Constant memory survives.** The engine runs on one block plus the incomplete trailing line, capped at
64 KB, however many matches that block contains. What can grow is the *consumer's* accumulation, which
is a consequence of the API's shape rather than of enumeration, and which the delivery shape below is
chosen to bound.

**The mid-download answer survives.** The first match is found at the same byte offset and surfaces at
the same millisecond it does today. What enumeration costs is **termination**, not the first answer.

The distinction matters because that sentence, left standing, is an argument against this record that
does not hold.

### Usage is not the justification

Measured 2026-08-05: `@netgrep/netgrep` has 503 npm downloads in the last year, 137 of them on
2026-08-03 alone — consistent with this repository's own release traffic — and 16 GitHub stars since
2022. There is effectively no consumer.

Two consequences, and the first is a refusal to overclaim. **This rewrite is not an adoption lever and
is not offered as one.** What gates adoption is discovery, and then the requirement that a file be
readable by an anonymous cross-origin request, which empties most of the addressable set. The cheapest
real widening of that set is `fetch` options passthrough — BACKLOG item **22** — which rode along as a
rider rather than as the headline: it landed in PR 6 on 2026-08-06, and closed item **29** with it.

The second is freedom. Nothing is deployed against the current surface, so this deletes rather than
deprecates.

## Decision

Two free functions replace the `Netgrep` class, which has held no state since
[0024](0024-remove-the-in-memory-cache.md) removed the cache and is therefore ceremony.

    grep(url, pattern, options?)    -> AsyncIterable<NetgrepHit>
    matches(url, pattern, options?) -> Promise<boolean>

A `NetgrepHit` carries the matching line with its terminator stripped, every match's position within
that line as UTF-16 offsets, and the line's **file-absolute 1-based number**. Nothing else: no byte
offsets, no match count — a consumer enumerating hits has its own index and a second source of truth
would only be able to disagree — and no ranking, refused for the reason 0025 gives and this record does
not touch, that there are no term statistics to rank with.

**Both generics die, and that is the shape of the win.** `metadata: T` exists only to route a batch
result back to its caller, and the batch methods go. `capture: C` exists so a boolean caller does not
pay for a string copy, and a streamed hit with no line is meaningless, so the line is unconditional.
`NetgrepResult<T, C>` collapses to a plain interface, and the four `as unknown as` casts it forced —
with the thirty-line comment explaining why they were unavoidable — delete with it.

**`matches()` is not a compatibility shim.** It keeps the `search_bytes` entry point, which allocates
nothing and copies nothing out of WebAssembly, and it stops at the first hit. Filtering many urls is a
real thing to want and a boolean is the right answer to it; what changes is that the boolean is no
longer the *only* answer.

**Hits are yielded one at a time and marshalled a block at a time.** The generator pulls a whole block's
matches across the WebAssembly boundary in one call, then builds each JavaScript object at the moment it
yields it. Two crossings per block regardless of hit count, and a consumer that renders and discards
keeps exactly one hit object alive. The alternative — `serde-wasm-bindgen` returning a vector of
structs — materialises every object eagerly, which on a 240 MB log searched for a common token is
hundreds of thousands of allocations live at once, aimed squarely at the property in the lede. It would
also add serde to a `.wasm` that item **14** already calls 12.6% too big.

An async iterable rather than a callback, for a reason that is not taste: the consumer's `await` is
backpressure, and `break` runs the generator's `finally`, where the reader is cancelled. A callback API
has the producer running ahead of whatever renders, and its natural usage — pushing into an array —
is exactly what breaks the memory property the previous paragraph protects.

## Consequences

**Early exit stops being a library policy and becomes a caller's choice.** Today netgrep stops at the
first match because a boolean is all it can say. After this, it reads until the caller stops asking, and
`matches()` is the degenerate case that stops after one. That is a better description of the same
mechanism, and [0003](0003-boolean-only-results.md)'s boolean survives inside it rather than being
overturned.

**Most of [0020](0020-the-matching-line.md)'s refusal table dissolves, and not because its reasoning was
wrong.** Every row in it was grounded in early exit. Line numbers were refused because *"the count would
be of searched lines, not file lines"* — under enumeration every byte is read from offset 0, so the
count is the file's. Match counts were refused because counting means reading the whole file — which is
now what happens. All matching lines were refused for the same reason plus unbounded result size, and
the second objection is answered by the delivery shape above rather than by argument.

Under [0022](0022-capture-ranges.md)'s rule a refusal reopens when its stated reason is shown false. That
is **not** what happened here: the reasons were true and this record chooses to pay them. Recording it
that way matters, because the rule is worth more than any row it protects.

**Ranking is refused, unchanged, and for its own reason.** It needs a scoring model, and netgrep has no
term statistics, no document frequencies and no index to build one from. No amount of reading the whole
file produces one. Keeping this separate from the early-exit refusals is deliberate; it has been
conflated once already.

**An error can now arrive after results have.** A connection dropped at 180 MB yields every hit up to
that point and then throws. That is partial, correct results plus a failure — a shape no caller of a
promise-returning `search()` has ever had to handle, and it is stated in the guide rather than left to be
discovered.

**Constant memory becomes a property of the pipeline, not only of the engine.** It was unconditional
under 0024 because netgrep retained nothing. It stays unconditional in the library, but a consumer that
accumulates every hit of a common pattern in a 240 MB log will exhaust the tab regardless of what the
library does. The lazy materialisation above is what keeps the honest usage the default one; the
documentation says the rest.

**Two open defects were closed on the way, and would have been worth closing anyway.** Item **3f** — a NUL
byte discarding the block that contains it — became load-bearing rather than cosmetic once line numbers
existed, because a discarded block desynchronises the running count for the rest of the file, which is a
quieter failure than a missed match. Item **17** — `$` never matching on CRLF input — was one line beside
it. Both shipped on 2026-08-05, before any of this record's own code, so that they stand if the rewrite does
not.

**Two things are deferred with their designs recorded rather than refused.** Context lines
(`before`/`after`) were the sole reason for the overlap window and match-holding scheme that an earlier
draft of this design carried; dropping them left the chunk-splitting logic untouched and halved the
encoding. They are additive to a returned object, so nothing here forecloses them. Range requests —
searching from an offset, or backwards from the tail — are the only capability that genuinely reduces
bytes read, and are the honest answer to the complaint this record opens by setting aside.

## Rejected alongside

| Ask | Why not |
|---|---|
| A worker for chunk searching | The loop already yields at every `reader.read()`, so the work happens in short slices, one per block. Enumeration raises the per-block cost but not its bound. The realistic jank source is a consumer rendering tens of thousands of rows. Item **23** stays a papercut |
| Match counts as a field | The consumer's own index is the count. A second source of truth could only disagree |
| Byte offsets | File-wide positions stayed refused under 0020 and 0022 and nothing here shows that reason false |
| Ranking | No term statistics, no document frequencies, no index. Unchanged from 0025 |
| Keeping `searchBatch` | `Promise.all` in four lines of user code, and its documented never-rejects behaviour is a footgun the guide currently carries a warning about |
