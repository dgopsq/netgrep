# 0019 — De-duplicate concurrent downloads of one url, but only when the cache is on

**Status: ACCEPTED (2026-07-30).** Closes [`BACKLOG`](../BACKLOG.md) item **18**, the last of what
[0018](0018-line-oriented-tail-buffer.md) left open, and records why the de-duplication is deliberately
conditional rather than universal.

## Context

`Netgrep.search` checked the memory cache and then fetched. Nothing sat between those two steps, so two
searches of the same url started before either resolved both missed the cache — it is written on `done`, which
neither had reached — and both downloaded the file.

Two shapes reach it in practice. `searchBatchWithCallback` starts every input eagerly with no concurrency
limit, so a corpus listing one url twice fetches it twice immediately. The demo hits it across *runs* rather
than within one: a keystroke aborts run N while run N+1 starts, so two searches of each url overlap for as long
as the aborted one takes to unwind.

0018 already took the sharp half. The entry used to be *appended* to per chunk, so the two downloads joined the
file to itself with no separator and the seam formed a line that existed nowhere — a file of `needle` cached as
`needleneedle`, with `^needleneedle$` answering `true`. Entries are now assigned once from a drained stream, so
what was left was purely a wasted request.

## Decision

A per-instance registry of searches currently in flight, keyed by url exactly as the cache is:

```ts
while (this.inFlight[url]) {
  await this.inFlight[url].catch(() => undefined);
}

const cached = this.memoryCache[url];
if (cached) return { url, pattern, result: search_bytes(cached, pattern), metadata };

const running = this.executeSearch<T>(url, pattern, metadata, config);
this.inFlight[url] = running;
```

Waiting then re-reading the cache is the whole mechanism: **the cache entry is the handover.** The waiter is not
given the first caller's bytes, or its result — it could not use the result anyway, since the two callers may
be searching for different patterns — it is given the entry the first caller writes, and searches it itself.

This required splitting `search` in two. The streaming loop moved unchanged into a private `executeSearch`, and
`search` became the coordination layer above it: engine gate, dedup wait, cache read, then register and run.
The loop could not stay where it was, because the wait has to happen *before* the promise executor rather than
inside it.

Three details are load-bearing:

- **A `while`, not an `if`.** Waking to a cold cache is normal, not exceptional — the download ahead may have
  matched early and cached nothing, or failed outright — and by then a third caller can already be re-fetching.
  With an `if` that third search and the waking waiter would run side by side, which is the original defect
  with more steps.
- **The waiter swallows the rejection it waits on.** Its recourse to a failed download is the same as its
  recourse to a miss: fetch below. Inheriting the failure would be wrong twice over — it never asked for that
  request, and the signal that aborted it is not the waiter's signal.
- **The registered promise is `running` itself**, with cleanup attached as `running.then(settle, settle)`.
  Both handlers, so the registry never adds a rejection nobody is listening to; the caller holds `running` and
  answers for that one. `settle` deletes only its own entry, never a successor's.

## Considered: making it work with the cache off

The registry does nothing when `enableMemoryCache` is false, and that is a design decision rather than an
omission. Without a cache there is no entry to hand a waiter, so sharing needs one of:

- **Collecting the chunks anyway** — which reintroduces exactly the cost 0018 had just removed, retaining all
  500 MB of a 500 MB file for a caller who asked not to keep anything.
- **Teeing the response stream** so both callers read the same download. That entangles abort ownership: the
  shared request carries the first caller's `AbortSignal`, so a keystroke aborting run N would now kill run
  N+1's download too — turning a wasted request into a wrong answer, which is a bad trade in a repository whose
  standing instruction is to stay conservative.
- **Waiting anyway, then fetching** — the worst option, since it saves no request and adds the first
  download's latency to the second caller.

So with the cache off both callers fetch, as they always have. There is no new configuration knob for this:
`NetgrepConfig` stays one field, and the behaviour follows the setting that already exists.

## Consequences

**The second caller answers later than it used to, and correctly.** It waits for the first download to drain
rather than racing it. Against the case this exists for — one url, two overlapping searches — that is a request
saved for latency that was mostly being spent anyway.

**A download that never settles now holds its waiters with it.** They used to fetch independently and stall on
their own request instead, which is the same outcome by a slower route — but it is a real coupling, and the
reason the registry entry is removed on rejection as readily as on success rather than being left to mark a
url as bad.

**The batch methods inherit it.** Both go through `search`, so a corpus listing one url twice now downloads it
once. No change to either method.

**Cache entries land more often**, since a shared download still writes one. That is more memory held by an
instance that has no eviction, size cap or TTL — item **19**, unchanged by this and mildly more reachable
because of it.

**One extra `await` on the cache-on path, and none on the fast path.** The `while` condition is a property
read, so a search with no concurrent duplicate is scheduled exactly as before. That matters more than it
sounds: the read-count and fetch-count assertions across both suites are sensitive to sequencing, and none of
them moved.

## What this does NOT fix

**Concurrent searches with the cache off**, per the section above. Pinned by
`still fetches twice for concurrent searches when the cache is disabled` in `Netgrep.integration.spec.ts`, so
the boundary is asserted rather than merely described.

**A waiter whose predecessor cached nothing.** Completeness is not known until `done`, so a search that matches
early resolves without writing an entry and its waiter has to fetch after all. One request saved is the common
case, not a guarantee. Pinned by `lets a waiter fetch for itself when the download ahead cached nothing`.

**The demo, which is unaffected and stays that way.** It runs with the cache off, so its overlapping runs still
fetch twice. Turning the cache on would fix that and break the page: a miss drains the stream, which is exactly
the condition for caching, so the `StatsBar` would start timing a `Record` lookup and presenting it as a
download. The page measures the network — see the comment in `use-corpus-search.ts` and
[`AGENTS.md` §2.3](../../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it).
