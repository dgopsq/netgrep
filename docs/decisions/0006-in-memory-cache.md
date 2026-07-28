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
entirely (the cache-hit branch at the top of `Netgrep.search`). While streaming, each chunk is appended via
`upsertMemoryCache`.

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
