# 0025 — netgrep is streaming grep over HTTP, not client-side site search

**Status: ACCEPTED (2026-08-02).** Amends [0017](0017-example-as-hosted-demo.md) and
[0023](0023-documentation-site.md) — both specified demo copy that this record rewrites. Cites
[0002](0002-search-while-downloading.md), whose decision it leaves entirely intact, and
[0024](0024-remove-the-in-memory-cache.md), which made the constant-memory claim unconditional.

(A draft of this record said it *amends* 0002. It does not, by the test
[0024](0024-remove-the-in-memory-cache.md) states: a record is amended when its decision survives in altered
form. 0002's decision — search each chunk as it arrives — survives in exactly the form it was written, and
this record leans on it rather than touching it. The ground that draft gave was also already spent: 0002's
"bytes may keep arriving" consequence is struck through and annotated *Fixed 2026-08-01*, by the
cancel-on-match change, not by anything here. Citation is the whole relationship, and the distinction is worth
a paragraph because the index table is read as a map of what is still in force.)

No issue preceded this one: as with [0022](0022-capture-ranges.md) and 0023, the argument was made in a
written design and reviewed before any code was written. Here there is no code at all — nothing under
`packages/*/src/` and neither test suite changes. What changes is every sentence that told a reader what this
project is.

## Context

The framing this record retires was not four years of settled honesty. It was two claims made four days apart,
and they are each other's opposite.

**The word *experimental* is genuinely 2022** — `693c3e6`, 2022-08-28 — but the sentence next to it said this:
*"The scope of this project is to provide a viable alternative to index-based search engines for applications
with a small files-based database."* That is a claim to **beat** index search on index search's own ground,
made by a project that could not rank, had never been measured against one, and shipped a megabyte of
WebAssembly to start.

**The concession is four days old.** `c4db8d8` (2026-07-29) put an *"experiment, not a recommendation"* callout
above the first paragraph, named Pagefind, Lunr and FlexSearch as usually smaller, faster and more capable, and
softened "provide a viable alternative" to "explore an alternative" so the page would stop contradicting
itself one line later. That was the right correction and an honest one — but it inverted the project's stated
purpose in a single commit and then left the inverted version as the headline. What a reader met from that day
until this one was a project introduced by the comparison it had just lost, with no sentence anywhere saying
what it is good at.

So the position being retired here is four days old, not four years, and the speed is evidence rather than
embarrassment: a framing that could be inverted and then discarded inside a week was never load-bearing. What
made it discardable is four findings.

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
   [0024](0024-remove-the-in-memory-cache.md) deleted the cache. A hand-written `fetch` loop feeding a
   per-chunk `RegExp` holds memory flat too, in about twenty lines; what is not otherwise available in a tab
   is doing it with **ripgrep's** engine, which is properties 3 and 6.
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

It is quoted verbatim in three places: the `README`'s first line, the first line of
[`docs/guide/01-getting-started.md`](../guide/01-getting-started.md), and the demo's `<noscript>` block. The
`#website` JSON-LD carries the phrase verbatim inside a longer description. The demo's `<title>`, `og:title`
and `twitter:title` carry a shortened variant — *grep over HTTP, **in** the browser* — because a title tag
truncates and the participle is the first word a reader loses. Everything else states the claim in its own
shape rather than the sentence: the hero, the meta description, `og:description`, `twitter:description` and
the `#library` JSON-LD name the properties instead, and `@netgrep/netgrep`'s README and `package.json`
description do the same — a package page and an 80-character npm field are not places to quote. A surface
that states the lede and a surface that states the properties are both correct; a count of quotations is not
the measure.

**One surface still carries the retired hero line, and it is not text.** `assets/header.png` — the masthead
of all three READMEs — and the demo's `og-image.jpg` are the same artwork, and both have *Search remote files
while they're downloading.* baked into the pixels. The three READMEs' alt texts now describe the wordmark
only, so a screen reader no longer meets the retired line before the lede; the demo's `og:image:alt` still
quotes it, because alt text has to say what the image shows and a description that contradicted the pixels
would be the worse error. Redrawing the artwork is the maintainer's call and is not scheduled here — this
paragraph exists so the next reader can find the one place the old wording survives.

**`@netgrep/search` deliberately does not carry it at all, and that is not an omission to correct later.** It
is the low-level core: a WebAssembly binary exporting three functions over a byte slice, with no `fetch`, no
stream and no HTTP anywhere in it. "grep over HTTP" would be false about that artefact and would pull readers
into the wrong package, so its README and `package.json` describe what it actually is — ripgrep's engine
compiled to WebAssembly, the core of `@netgrep/netgrep` — and send a reader to the wrapper, which is what
someone landing there most needs to be told. A surface that states the lede and a surface that states its own
subject are both correct; only a surface that states neither is a regression.

Where the old framing chose to compare, the new one states, and the comparison survives once — plainly, on the
limitations page and in the guide's *What this is for*, where a reader who needs an index is routed to one.

## Consequences

**The hedges are gone from above the fold, not from the project.** Every fact the old blocks carried is still
published, in the place where it informs rather than deters: the WebAssembly download is a cost line under
*Requirements* in the README and the guide, and a clause of the closing paragraph in `@netgrep/netgrep`'s own
README, which has no bullets and no Requirements section — an npm page is read top to bottom, not scanned;
where a prebuilt index beats netgrep is stated on the limitations page and in the guide, with Pagefind, Lunr
and FlexSearch named; the match details netgrep refuses are stated in `@netgrep/netgrep`'s README and in the
guide, while `@netgrep/search`'s keeps the two caveats that belong to the engine rather than to the wrapper —
a NUL byte discarding the block, and `$` on CRLF. Nothing was quietly dropped, and the test for any sentence
written under this record is whether a developer who reads it, installs the package and hits the limit an
hour later would feel informed or misled.

**The lede promises files you do not control, so CORS became a *Requirements* line.** Under the old framing
the corpus was one you generated and served from your own origin, so the question never arose; a reader told
netgrep works on files someone else hosts will point it at one, and the first thing that happens is an opaque
network error before a single byte is searched. So `A URL the browser will let you read` now sits beside the
browser, ESM and WebAssembly requirements in the README and the guide, in `@netgrep/netgrep`'s README as prose
in the paragraph that states what it runs on, and in [`ARCHITECTURE.md`](../ARCHITECTURE.md#scope)'s *Scope*
for the maintainer who reads the requirement list there rather than on a package page. It also bounds the
claim usefully, which is why it belongs here rather than in four bullets nobody argued: netgrep's ground is a
file you do not control **and whose host will let a browser read it**. Widening what a project claims widens
the failure modes a reader meets first, and this is the one that bites first.

**The same argument makes credentials a *Requirements* line, and it was missed once.** CORS is a gate, not
*the* gate. The wrapper passes only `signal` to `fetch`, so no `Authorization` header and no API key are sent,
and `Request.credentials` defaults to `same-origin`, so a cross-origin request carries no cookies either. A
host can answer `Access-Control-Allow-Origin: *` and still hand an anonymous reader a 401 — which means the
bound is not a subset of the CORS one and cannot be left implied by it. It was recorded twice, in
[`BACKLOG`](../BACKLOG.md) item **22** and in *Rejected alongside* below, and both of those are read by
maintainers; nothing a consumer reads said it. It now sits beside the CORS line in all four places, and the
guide's *What this is for* is qualified to match: a CI artefact behind a provider login and a session-gated
support log are named as out of reach today, with the signed or openly published URL that puts them back in.
Refusing to soften the audience was deliberate — the niche argued above is a **person** with no shell, and
that person is still real; what changed is that the guide now says which of their files netgrep can actually
open. Lifting the bound is item 22's job.

**This does not pressure [0003](0003-boolean-only-results.md), and saying so is the point.** The obvious worry
is that calling something *grep* invites every ask grep answers — counts, all matches, ranking — and that a
bolder claim makes the boolean look like a gap. The dependency runs the other way. 0003's boolean is what lets
the searcher stop at the first match; stopping at the first match is what makes early exit possible; early
exit is what makes property 1 and property 2 above true at all. Match counts and all matching lines each
delete early exit outright — you cannot count or enumerate what you have not read, so each turns every search
into a full download and takes constant memory and the mid-download answer with it. The new framing therefore
**strengthens** 0003 rather than straining it: the boolean is no longer "all we bothered to return", it is
the mechanism the headline properties rest on. [0022](0022-capture-ranges.md)'s refusal table stands
unchanged, including its rule that a row reopens only when its stated reason is shown false.

Ranking is refused too, and **not** for the early-exit reason — keeping the two apart matters, because it has
been got wrong once already. Ranking needs a scoring model, and netgrep has no term statistics, no document
frequencies and no index to build one from. There is nothing to rank *with*, which is why the honest answer
stays "use an index" and why no amount of reading the whole file would produce one.

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
