# 0025 — netgrep is streaming grep over HTTP, not client-side site search

**Status: ACCEPTED (2026-08-02).** Amends [0002](0002-search-while-downloading.md) (its
"bytes may keep arriving" consequence was closed by the cancel-on-match fix),
[0017](0017-example-as-hosted-demo.md) and [0023](0023-documentation-site.md) (the demo's framing).
Cites [0024](0024-remove-the-in-memory-cache.md), which made the constant-memory claim unconditional.

No issue preceded this one: as with [0022](0022-capture-ranges.md) and 0023, the argument was made in a
written design and reviewed before any code was written. Here there is no code at all — nothing under
`packages/*/src/` and neither test suite changes. What changes is every sentence that told a reader what this
project is.

## Context

For four years the README opened by saying netgrep was an **experiment** in client-side search over a small,
static, file-based corpus, and that a prebuilt index would usually beat it. Both halves were honest, and that
is the only thing to be said for them. The framing picked the one workload netgrep is worst at, conceded it in
the first paragraph, and left a reader with no idea what the library is *for*. Four findings killed it.

**The site-search economics lose, and no version of them wins.** A visitor pays ~500 KB gzipped of
WebAssembly before the first query is typed, and then the corpus downloads — every byte of every file,
matching or not, because there is nothing else to read. Pagefind answers the query actually typed out of a few
KB of index shards it fetches on demand. That is a loss on download size, on latency and on capability
simultaneously. [0022](0022-capture-ranges.md) removed the one objection that was closing — a result can now
carry the matching line and each match's position within it, so netgrep can back a highlighted results list.
Ranking is still refused, and ranking is table stakes for search. A project whose headline is a comparison it
loses is not being modest; it is letting its worst case do the describing.

**A principal engineer who works on logging at a bank rejected the log-search angle**, on two grounds, neither
of which is about netgrep's implementation. **Data locality**: *ssh to the box and search there, always* — the
right move is to send the pattern to the bytes, and netgrep sends the bytes to the pattern. **Semi-indexing**:
the formats logs actually land in are Parquet and Iceberg, whose row-group statistics and bloom filters skip
nearly all the bytes before anything is read, where netgrep reads 100% of them. Logs are also the worst
selectivity case there is — you download the whole file and keep almost none of it, and the ratio gets worse
as the file gets bigger, which is the direction log files go.

**He conceded exactly one case, and it is the one worth having.** When the bytes are moving anyway, because a
human is going to open and read the file, the search rides along for free: the download is already paid for,
and netgrep answers before it finishes rather than after. That is a **viewer** feature rather than a search
system, and naming it that way is what makes it a real claim instead of a smaller version of the losing one.

**Bureaucracy does not push people off the correct server-side architecture — it pushes them onto it.** The
tempting story was that netgrep serves the developer whose organisation will not provision a search backend.
It is false, and it is backwards: when provisioning is hard, you ssh to the box that already exists and run
the tool that is already installed. The constraint that actually produces netgrep's user is not slow
procurement, it is **having no shell on the machine that holds the file** — an artefact on a CI platform you
are a customer of, a published corpus on someone else's host, a log a support agent can open in a browser and
nowhere else. The niche is defined by a **person**, not by a workload or a corpus size. That inversion is the
single most useful thing this investigation produced, and it is why the guide's *What this is for* is now
written around an audience.

## Decision

Describe netgrep by what it does. The costs stay, as costs.

Six properties, in the order they matter:

1. **Constant memory over unbounded input.** One chunk plus the incomplete trailing line, capped at 64 KB,
   however large the file is — a property of the code rather than of a caller's configuration since
   [0024](0024-remove-the-in-memory-cache.md) deleted the cache. Nothing else available in a browser tab
   searches a file larger than the tab can hold.
2. **An answer before the last byte.** [0002](0002-search-while-downloading.md): the engine runs on each chunk
   as it arrives, so a match in the first kilobyte resolves without the remaining megabytes. Since the
   cancel-on-match fix the reader is cancelled at the match site, so early exit ends the transfer rather than
   abandoning it, and saves bandwidth as well as latency.
3. **Real regex, not tokens.** `[[:alpha:]]`, `(?x)`, smart case, arbitrary mid-word substrings — the
   `grep-matcher`, `grep-regex` and `grep-searcher` crates, unmodified from crates.io. An index matches the
   tokens it was built to match, and a substring nobody tokenised is not in it.
4. **No index, no build step, no backend, nothing to go stale.** There is no artefact to keep in sync with the
   corpus, so a file that appeared thirty seconds ago is searchable now.
5. **Nothing to provision, and the query never leaves the browser.** The pattern is compiled in the tab that
   typed it. No server sees it, so there is no operator to trust and no request to audit.
6. **The hard parts are done and pinned by tests.** Chunk-boundary matching is exact to the line
   ([0018](0018-line-oriented-tail-buffer.md)), early exit is real rather than a latency trick, and what
   remains wrong is written down and asserted rather than hidden — see
   [0011](0011-tests-that-assert-known-bugs.md).

The lede, in one sentence:

> **netgrep is grep over HTTP, running in the browser.**

It is stated in the `README`, both published npm READMEs, both `package.json` descriptions, the first line of
[`docs/guide/01-getting-started.md`](../guide/01-getting-started.md), and the demo's hero, `<title>`,
description, Open Graph and Twitter cards, JSON-LD and `<noscript>` block. Where the old framing chose to
compare, the new one states, and the comparison survives once — plainly, on the limitations page and in the
guide's *What this is for*, where a reader who needs an index is routed to one.

## Consequences

**The hedges are gone from above the fold, not from the project.** Every fact the old blocks carried is still
published, in the place where it informs rather than deters: the WebAssembly download is a cost line under
*Requirements* in the README, the guide and `@netgrep/netgrep`'s own README; where a prebuilt index beats
netgrep is stated on the limitations page and in the guide, with Pagefind, Lunr and FlexSearch named; the
match details netgrep refuses are stated in both npm READMEs and in the guide. Nothing was quietly dropped,
and the test for any sentence written under this record is whether a developer who reads it, installs the
package and hits the limit an hour later would feel informed or misled.

**The lede promises files you do not control, so CORS became a *Requirements* line.** Under the old framing
the corpus was one you generated and served from your own origin, so the question never arose; a reader told
netgrep works on files someone else hosts will point it at one, and the first thing that happens is an opaque
network error before a single byte is searched. So `A URL the browser will let you read` now sits beside the
browser, ESM and WebAssembly requirements in the README, the guide and the npm README. It also bounds the
claim usefully, which is why it belongs here rather than in three bullets: netgrep's ground is a file you do
not control **and whose host will let a browser read it**. Widening what a project claims widens the failure
modes a reader meets first, and this is the one that bites first.

**This does not pressure [0003](0003-boolean-only-results.md), and saying so is the point.** The obvious worry
is that calling something *grep* invites every ask grep answers — counts, all matches, ranking — and that a
bolder claim makes the boolean look like a gap. The dependency runs the other way. 0003's boolean is what lets
the searcher stop at the first match; stopping at the first match is what makes early exit possible; early
exit is what makes property 1 and property 2 above true at all. Ranking, match counts and all-matching-lines
each delete early exit outright — you cannot score, count or enumerate what you have not read, so each turns
every search into a full download and takes constant memory and the mid-download answer with it. The new
framing therefore **strengthens** 0003 rather than straining it: the boolean is no longer "all we bothered to
return", it is the mechanism the headline properties rest on. [0022](0022-capture-ranges.md)'s refusal table
stands unchanged, including its rule that a row reopens only when its stated reason is shown false. Ranking's
reason is not the early-exit one and is worth keeping straight, because it was got wrong once: ranking needs a
scoring model, and netgrep has no term statistics, no document frequencies and no index to build one from.
There is nothing to rank *with*.

**The demo now claims something it cannot yet demonstrate.** The hero's accent is constant memory — *on files
your tab could never hold* — and the page proves nothing of the sort. Constant memory is a documented property
a visitor can check in devtools, not a number the page renders: netgrep exposes no progress, and peak memory
is not reliably measurable from inside the page. The corpus is 56 files of a few dozen KB each, which is the
old framing's corpus. PR 4's large-file act closes the gap for the timing half, by reporting elapsed-at-answer
against elapsed-for-a-full-miss on one big file, and this record will be amended when it lands. Until then the
accent is the one claim a visitor takes on trust. **Do not invent a number to fix this** — a fabricated or
proxied memory figure on the one page whose entire value is that it is accurate would cost more than the gap
does.

**Two asks move onto the backlog rather than being refused outright.** `fetch` options passthrough
([`BACKLOG`](../BACKLOG.md) item **22**) and a worker (item **23**). Both are real, both are widenings, and
both need their own issue and their own argued record under
[AGENTS.md §1](../../AGENTS.md#1-what-this-project-is). They are named in the table below so that deferring
them is not mistaken for refusing them on the merits — the distinction the table exists to keep.

## Rejected alongside

| Ask | Why not |
|---|---|
| gzip / `DecompressionStream` content decompression | netgrep already searches transport-compressed responses for free — the browser decompresses before `res.body` exists. Content-level `.gz` needs an API change, since netgrep owns its own `fetch`, and ripgrep's own `-z` is the CLI shelling out to `gzip`/`xz` binaries, not anything in the three `grep-*` crates. Needs its own record |
| `fetch` options passthrough / authenticated URLs | Only `signal` is passed today. A real ask and a real widening — backlog item **22**, not this PR |
| A worker | Chunk searching runs on the main thread. Backlog item **23** |
| Package renames, a new npm scope, API widening | [0022](0022-capture-ranges.md) was the last widening and was argued on its own merits. A repositioning is not a licence to reopen the surface |
| A CORS proxy for the demo | A third-party runtime dependency on the one page whose entire value is that it is accurate |
| Live-fetching Zenodo, or any third-party corpus host | No CORS, zip containers, and a research host's bandwidth is not ours to spend |
