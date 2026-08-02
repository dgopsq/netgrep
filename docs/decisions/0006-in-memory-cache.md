# 0006 — Cache downloaded bytes in memory, on by default

**Status:** Accepted, **with known defects.** See *Current assessment*.

## Context

An interactive search box issues many searches against the same small set of URLs as the user types. Without
caching, every keystroke re-downloads the entire corpus. HTTP caching helps but is not guaranteed, and does
not avoid re-reading the stream.

## Decision

`Netgrep` keeps a private `Record<string, Uint8Array>` of downloaded bytes, keyed by URL, and enables it by
default:

```ts
const defaultConfig: NetgrepConfig = { enableMemoryCache: true };
```

On a cache hit, `search_bytes` runs once over the stored bytes and resolves immediately, skipping `fetch`
entirely (the cache-hit branch at the top of `Netgrep.search`). While streaming, chunks are collected and the
entry is written once, when the reader reports `done` — see the amendment below; this used to append per chunk
via `upsertMemoryCache`.

The cache is per-instance, so a consumer can scope or discard it by managing the `Netgrep` object's lifetime.

## Consequences

- Repeat searches over the same corpus cost no network at all.
- Memory is traded for latency, which is the right trade for the intended corpus size (dozens of small text
  files).
- On by default means a consumer who never reads the docs gets unbounded memory growth silently.

## Current assessment

The cache interacts badly with [0002](0002-search-while-downloading.md) and has three defects, all present in
published `0.1.5`, all documented in [`../ARCHITECTURE.md`](../ARCHITECTURE.md#known-limitations--correctness-caveats):

1. **Partial entries are treated as complete.** The stream stops being read on the first matching chunk, so
   the cache retains only a prefix — with no flag recording that. A later search for a different pattern reads
   that truncated prefix and returns a **false negative**. This is a correctness bug, not a performance one.
2. **No eviction.** No cap, no TTL, no LRU. Full file bytes are retained for the instance's lifetime.
3. **O(n²) population.** `upsertMemoryCache` allocates a new array and copies everything accumulated so far on
   *every chunk*, rather than collecting chunks and joining once.

Defect 1 is the important one, and it cannot be fixed independently of the chunk-boundary bug — a naive fix
(always drain the stream so the cache is complete) discards the early-resolution benefit that is the entire
point of [0002](0002-search-while-downloading.md).

A correct design tracks completeness per entry: partial entries may be used to *resume* a download, never to
*answer* a query.

## Amendment (2026-07-30) — defects 1 and 3 are fixed, by a smaller change than the one proposed above

See [0018](0018-line-oriented-tail-buffer.md). **The entry is written only when the reader reports `done`**, so:

- **Defect 1 is gone.** A partial entry is never created, rather than created and flagged. That is narrower than
  the completeness tracking recommended above, and deliberately so — a partial entry cannot resume a download
  either, and nothing in the library needed it to. The cost is a re-fetch where there used to be a wrong
  answer. Note that a match in the *final* chunk still caches nothing: the stream is not known to be complete
  until `done`, which is one read later.
- **Defect 3 is gone.** Deferring the write requires collecting chunks and joining once, which is exactly what
  that defect asked for. Chunks are also only collected when the cache is *enabled* — before this, a search with
  `enableMemoryCache: false` was paying to retain a whole file for a cache it never wrote to.
- **Defect 2 remains** and is now backlog item 19.

The "cannot be fixed independently of the chunk-boundary bug" claim above held up, though not for the reason
given. Draining the stream is a failure mode of naive fixes to either, not a coupling. The real coupling ran the
other way: the chunk-boundary bug was *suppressing* early resolution, because a search whose match straddled a
boundary missed and therefore drained. Fixing it alone would have left more searches resolving early and more
prefixes cached — a regression in the default configuration.

One consequence for callers: **`enableMemoryCache: false` is no longer a workaround for a correctness defect.**
It is now only a memory/bandwidth trade.

## Amendment (2026-07-30) — the flag now also decides whether concurrent downloads are shared

See [0019](0019-in-flight-fetch-registry.md). Two searches of one url started before either resolves used to
fetch it twice; the second now waits for the first and is answered from the entry it writes.

That makes `enableMemoryCache` do a second thing. The entry **is** the handover — a waiter is given no bytes
and no result, only the cache — so with the flag off there is nothing to hand over and both callers still
fetch. Sharing regardless would mean either retaining every chunk of a file the caller asked not to keep, or
teeing the response stream and with it the first caller's abort signal.

So the trade this record describes has grown a third term: `enableMemoryCache: false` costs a repeat download,
retains nothing — and no longer collapses concurrent downloads of the same url either.

## Outcome (2026-08-01) — the cache is removed, and with it this record's decision

See [0024](0024-remove-the-in-memory-cache.md). Nothing survives of the decision above: there is no
`memoryCache`, no `enableMemoryCache`, and no `NetgrepConfig`.

What this record got right is the trade it described. What it got wrong is that the trade was available to
make: the platform's own HTTP cache does the same job with eviction, across page loads, and — the part that
matters most here — it serves a warm hit as a *stream*, so early resolution survives it. The memory path
never did: a hit re-ran the engine over the whole buffer. The cache bought back the download and paid full
price for the search.

Defect 2 above, the missing eviction, was never fixed. It was deleted along with the thing that had it.
