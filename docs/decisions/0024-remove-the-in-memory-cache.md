# 0024 — Remove the in-memory cache entirely

**Status: ACCEPTED (2026-08-01).** Supersedes [0006](0006-in-memory-cache.md) and
[0019](0019-in-flight-fetch-registry.md). Closes [`BACKLOG`](../BACKLOG.md) item **19** by deletion,
and reopens item **18** in substance while accepting it — see *Consequences*.

(The plan this came from said 0024 would *amend* 0006, as [0018](0018-line-oriented-tail-buffer.md) and
0019 did. It supersedes it, and that is not a formality. A record is amended when its decision survives in
altered form and superseded when it survives in none — and "cache downloaded bytes in memory, on by default"
survives in none: there is no cache, no flag, and no object to put a flag on. 0019 goes the same way for the
same reason, since the entry it handed a waiter is what no longer exists.)

## Context

Four facts, each of which stands on its own. A later change repositions what this project claims to be, and
this record deliberately leans on none of it: the cache should come out even for a reader who thinks netgrep
is exactly what it has always said it is.

**The browser already does this, and better.** Measured against GitHub Pages, which hosts the demo, on
2026-08-01: `cache-control: max-age=600`, a strong ETag, and a conditional request answered `304, 0 bytes`.
That cache has eviction, it survives a page reload, and it is shared with every other fetch on the page —
none of which a `Record<string, Uint8Array>` on one `Netgrep` instance had, or could have been given cheaply.

**It saved the network and never the search.** A warm hit did not short-circuit; it re-ran the engine over
the whole stored buffer (`Netgrep.ts:309`, before this change), so the cache bought back the download and
then paid full price for the match. Worse for the property this library exists for: a warm *HTTP* hit is
served as a **stream**, so early resolution works on it exactly as a cold one does, and the memory path had
no stream to resolve early against. The platform's cache is compatible with 0002; this one was not.

**No eviction, no size cap, no TTL** — BACKLOG item **19**, open since [0018](0018-line-oriented-tail-buffer.md)
split it out of item 11, and named as defect 2 in 0006 itself from the day that record was written. The full
bytes of every file searched, retained for the instance's lifetime, on by default.

**Both of this library's historical P1 correctness defects came out of it.** BACKLOG 3b, where an early
resolution left a *prefix* in the cache with nothing marking it partial and the next search for a different
pattern answered `false` about text that was never downloaded. And the sharp half of BACKLOG 18, where the
entry was appended to per chunk and two concurrent downloads joined the file to itself, forming a seam line
that existed in no file — `needle` cached as `needleneedle`. Both are fixed, and both were caused by the same
object; there is no third defect to point at, but there was also nothing in the design making a fourth
unlikely.

## Decision

Delete it. `memoryCache`, `inFlight`, `commitMemoryCache`, the per-chunk accumulation, the cache-read branch
and `NetgrepConfig` are gone, and the constructor takes no arguments:

```ts
const NG = new Netgrep();
```

`concatBytes` stays. It has a second caller and always did — joining the held-back incomplete line to the
incoming chunk, which is [0018](0018-line-oriented-tail-buffer.md)'s tail and has nothing to do with caching.
`NetgrepSearchConfig` — `signal`, `capture`, `maxLineBytes` — is untouched: per-call configuration was never
the thing at issue.

**Why removal rather than a flipped default.** Keeping the cache opt-in and defaulted off would fix the
memory growth and none of the rest: the machinery stays in the loop, the two defect mechanisms stay reachable
by anyone who sets the flag, and the API keeps a whole configuration axis — `NetgrepConfig` had exactly one
field — to hold a flag nobody would be advised to set. A default is a recommendation; an option is a promise
to keep the code working. This library is not in a position to make the second one about a cache the browser
already provides.

## Consequences

**BACKLOG 18 is reopened in substance, and accepted.** 0019's central sentence was that *the cache entry is
the handover*: a second caller of one url waits for the first and is then answered from the entry the first
writes. With no entry there is nothing to hand over, and the only two ways to reinstate the sharing are the
ones 0019 already rejected — retain every chunk of a file nobody asked to keep, or tee the response stream
and with it the first caller's `AbortSignal`, turning a wasted request into a wrong answer. So both callers
fetch. That is why the `concurrent-dedup` caveat moves from `defect` to `by-design`, and why item 18 stays in
*Done* with an amended outcome rather than returning to Open: an Open P1 item on this project's backlog is
one pinned by a test asserting **wrong** behaviour, and this behaviour is intended.

**It breaks consumers, at `tsc`.** `NetgrepConfig` no longer exists, and `new Netgrep({ … })` no longer
accepts an argument. Neither failure is silent, which is the whole of the migration story: delete the
argument, delete the import.

**The live consumer at <https://diegopasquali.com/search> is the workload that loses most** — an interactive
box re-querying a small corpus on every keystroke, which is precisely what 0006 was written for. It now falls
back to its own host's headers, and that fallback is not free. The site is Cloudflare-fronted; its hashed
static assets carry `cache-control: public, max-age=14400, must-revalidate` with a weak ETag, while its
*content* responses — sampled at `/rss/feed.json` on 2026-08-01 — carry `max-age=0, must-revalidate` with a
strong ETag. If the corpus is served like the content rather than like the assets, a repeat query costs one
conditional round trip per file: a `304` with no body, but a round trip, where the memory cache cost nothing.
The corpus URLs are built client-side and could not be read off the page, so this is the **shape** of the
cost and not a measurement of it. **Worth checking against the real corpus before the release that ships
this.**

**Two entries leave the `documented defects` block** of `Netgrep.integration.spec.ts`, which is otherwise
never edited. `BACKLOG 3b (FIXED)` goes because the mechanism it pinned is deleted — there is no partial
entry to poison, so there is nothing left that could regress. `BACKLOG 18 (FIXED)` goes because its
assertion is now an ordinary one: it moved, inverted, into a `retaining nothing` block as *fetches once per
concurrent search of one url, by design*, beside the design boundary it merges with. The rule that sets, and
it is the general one: **a defect whose mechanism is deleted leaves the block; one that regresses stays in
it, re-inverted.** Recorded in [AGENTS.md §2.1](../../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose),
because §2.1 otherwise reads as forbidding both.

**The constant-memory claim stops being conditional.** One chunk plus the incomplete line at its end, capped
at 64 KB, however long the file is — previously true only with `enableMemoryCache: false`, and now a property
of the code rather than of a caller's configuration.

## Considered and rejected

| Ask | Why not |
|---|---|
| In-flight de-duplication keyed on `url + pattern + capture`, handing over the *result* rather than the bytes | Genuinely attractive, and the one idea here that would keep 0019's benefit while retaining nothing: item 18's scenario is one batch issuing two searches of one url, which necessarily share a pattern. It is new feature work all the same — a new mechanism with its own lifetime and abort questions — and per [AGENTS.md §1](../../AGENTS.md#1-what-this-project-is) that needs its own issue and its own argued record. Named here so it is not mistaken for something this record refused on the merits |
| Keeping the cache as an opt-in, defaulted off | Leaves the machinery in the API. `NetgrepConfig` has exactly one field, so this preserves a whole configuration axis to hold one flag nobody is advised to set — see *Decision* |
| An LRU, a size cap or a TTL | Fixing item 19 rather than deleting it. It is a cache the platform already provides, with eviction this one would have to reinvent, and the reinvention would still not survive a page reload or be shared with any other fetch |
| A `clear()` method, so a long-lived page can bound the growth by hand | Moves the eviction policy onto the consumer and keeps every other cost. The consumers who would call it correctly are the ones who would rather it did not exist |
