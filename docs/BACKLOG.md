# Maintenance backlog

**Project status: maintained, conservative.** This list is scoped to keeping netgrep correct, buildable and
releasable, and everything currently *open* on it is a defect or a piece of health work.

**Feature work is not planned here.** It starts as an issue, is argued there, and lands with a decision record
that also says what it does *not* open the door to — see
[`../AGENTS.md` §1](../AGENTS.md#1-what-this-project-is). A completed feature is recorded in *Done* below like
anything else, so the numbering stays a single sequence. If an item here seems to need a new feature, stop and
open an issue rather than expanding its scope.

Item numbers are stable and referenced from code comments and other documents. **Do not renumber.** Completed
items move to the bottom rather than disappearing.

**One number was used twice, and it is staying that way.** **19** is both *Return the matching line alongside
the boolean* (Done, cited as `BACKLOG 19` from `Netgrep.ts`, `Netgrep.spec.ts` and
`Netgrep.integration.spec.ts`) and *The cache has no eviction, size cap or TTL* (Done as of 2026-08-01, cited
as `item **19**` from decisions 0006 and 0019). The cache item had it first —
[0018](decisions/0018-line-oriented-tail-buffer.md) split it out of item 11 onto what was then the next free
number. The matching line landed in *Done* the next day and took its number from
[issue #19](https://github.com/dgopsq/netgrep/issues/19), which had already been used. Renumbering either would
break the citations that make these numbers worth having, so both keep it — which is why a reference should
say what it points at, not only its number.

Rules that apply to all of it: dependency changes are never a side effect of other work, and releases are
human-triggered only — the human act being the merge of release-please's release PR. See
[`../AGENTS.md` §6](../AGENTS.md#6-hard-rules).

**Type your commits with the release in mind.** `chore:` neither releases nor appears in a changelog, so
maintenance that changes the published bytes belongs under `fix(search):`, and a change a visitor can see on
the demo belongs under `fix(example):`. AGENTS.md §6 rules 2 and 3 explain why.

Verified against the repository on **2026-07-30** (macOS arm64, Node 24.18.0, Rust 1.97.1).

---

# Open

## P1 — Correctness

Full analysis in [`ARCHITECTURE.md`](ARCHITECTURE.md#known-limitations--correctness-caveats).

Every item below is **pinned by a test that asserts the current, wrong behaviour** — in
`Netgrep.integration.spec.ts` and, for what 3g does to `grep`, in `grep.integration.spec.ts`; for the ones
that live in the engine also in the `documented_defects` module of `packages/search/tests/search.rs`. Item
**29** is the exception and has no test: a transfer that cannot be stopped produces no wrong answer to pin.
Read
[`../AGENTS.md` §2.1](../AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose)
and [decision 0011](decisions/0011-tests-that-assert-known-bugs.md) before touching any of them: **fixing one
means inverting its assertion in the same PR.**

> [!IMPORTANT]
> **Moving an item to _Done_ is not finished until the demo site stops warning about it.** The published
> documentation at <https://netgrep.diegopasquali.com/docs/> names the defects a visitor is affected by, and
> every one of them lives once in [`guide/caveats.data.json`](guide/caveats.data.json). Delete the entry and
> run `pnpm docs:sync`, or the site goes on warning the world about a bug you just fixed.
>
> **The two lists are not mirrors of each other.** Every P1 item still open here has an entry there today
> except **29**, which is `grep`-only and waits on `grep`'s own consumer documentation like the `grep` half of
> 3g; and that file also carries two `by-design` entries that nothing *open* here corresponds to: *no ranking*,
> which has never been a backlog item at all, and *concurrent downloads of one url*, which is item **18** —
> in *Done*, and staying there. An entry earns its place there by affecting a visitor, which is a judgement
> call rather than a lookup. `pnpm docs:sync --check` keeps the two rendered surfaces honest
> to that file; what it cannot tell you is that an item here needs an entry there at all, or that an entry
> there has stopped being one — `concurrent-dedup` moved from `defect` to `by-design` on 2026-08-01 when
> [0024](decisions/0024-remove-the-in-memory-cache.md) removed the cache, and nothing but a reader would have
> noticed. See
> [`../AGENTS.md` §2.3](../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it).

**3a and 3b were fixed together on 2026-07-30** — see the *Done* table and
[decision 0018](decisions/0018-line-oriented-tail-buffer.md). They had to be: 3a was suppressing early
resolution, so fixing it alone would have made 3b fire more often, in the default configuration. 3a left a
residual, recorded as **3g** below.

### 3g. Anchors and long matches are unreliable inside a line longer than 64 KB — `packages/netgrep/src/lib/Netgrep.ts`

What 3a's fix does not cover. `splitAtLastLine` retains the incomplete trailing *line* between chunks, which is
exact — a match cannot span a `\n`. But a line with no terminator in it would buffer an entire response, so
past a 64 KB ceiling the tail degrades to a plain window on the last 64 KB. Three consequences, in both
directions:

- **A match longer than 64 KB is lost**, because it starts before the retained window and ends after the buffer.
- **`^` can match where no line begins.** A windowed tail starts mid-line and the engine cannot be told so, so
  it anchors to the window's first byte. A false positive, unlike every other entry in this list.
- **A captured line is a mid-line fragment.** Added by item 19: with `capture` on, the string returned for
  a match inside an over-long line begins at whatever byte the window fell on, so it is not a line (and, with
  `capture: 'line-ranges'`, possibly an empty `ranges` — the fragment need not contain the match). `result` is
  still right. Returning `null` instead was rejected in [decision 0020](decisions/0020-the-matching-line.md) —
  it would cost every consumer a null check on a branch the type has already narrowed, to describe a case only
  minified input reaches.

Needs one line longer than 64 KB **and** a match spanning most of it, so it is unreachable in hand-written
text — or in machine-written log output: the demo's log files are 408.6 MB whose longest line, across all four
sources, is 387 bytes. Total size does not reach this; line length does. Reachable in minified JavaScript or
a single-line data dump.

Pinned by the three `BACKLOG 3g` tests in `Netgrep.integration.spec.ts`, each with the control case that must
not regress — a match arriving complete in **one** chunk is found, because the buffer is searched whole before
the window is taken; `^` does not match when the window is never flushed on its own; and a line captured from a
single chunk starts where the line starts.

**`grep` hits the same window and adds two more consequences**, confirmed against the real engine. A hit
inside an over-long line is **yielded more than once** — the windowed tail is searched as the whole of one
block and again as the head of the next, so each pass reports the hit again. And the running file-absolute
line base **gains a line at every window slide**: on the tested fixture the two lines following the over-long
one are truly 2 and 3, and `grep` reports 3 and 4 — the drift carries forward into every line number after it
rather than being spent on the first of them, which is why the fixture has two lines and not one.
Both are pinned rather than fixed, and deliberately: suppressing the repeat would drop the hit outright if the
stream ended inside the window, and a lost hit is worse for a grep than a repeated one; the windowed tail,
once searched, is never re-searched at EOF, so there is no later pass that could correct the count. Pinned by
`BACKLOG 3g: a hit inside an over-long line is yielded three times` and
`BACKLOG 3g: the line number drifts after an over-long line` in `grep.integration.spec.ts`. Not yet in
[`guide/caveats.data.json`](guide/caveats.data.json) below — the published list still describes only
`Netgrep`, deliberately, until `grep`'s own consumer documentation lands.

**Published anyway**, in [`guide/caveats.data.json`](guide/caveats.data.json) and so in the guide and the
README, alongside item 25 below. The demo used to filter its own list down to what its own files could reach;
it no longer carries one, and a reader running netgrep over minified JavaScript reaches this whether or not
the demo's logs do.

Not obviously worth fixing. Raising the ceiling trades memory for a case nobody has hit; removing it means
buffering without bound. Left recorded rather than planned.

### 25. `^`/`$` anchor to a bare `\r`, but the line splitter does not — `packages/search/src/lib.rs`

A side effect of fixing item 17, found by review rather than by design. `RegexMatcherBuilder::crlf(true)` —
the fix for `$` on CRLF input — enables the regex engine's CRLF-aware anchors, and those treat a lone `\r` as
a line boundary too, not only a `\r\n` pair. The line splitter (`grep-searcher`'s own line-finding, unrelated
to the matcher's anchor config) disagrees: it still only ever breaks a chunk into lines on `\n`. So on input
using bare CR line endings — old Mac text, or log output using `\r` to overwrite a progress line in place —
the anchors and the returned line describe different boundaries for the same bytes.

```
"foo\rbar\n" ~ "foo$"              -> true    # was false before item 17
"foo\rbar\n" ~ "^bar"              -> true    # was false before item 17
"foo\rbar\n" ~ capture: 'line'     -> "foo\rbar"   # NOT "foo", even though "foo$" just matched
```

`result` is correct either way — the anchors did match. What is surprising is `capture`: a caller whose
pattern matched on the strength of `$` reasonably expects the returned line to end where `$` matched, and it
does not.

A fix would mean either making the line splitter agree with the anchors — teaching it to also break on a bare
`\r`, which `grep-searcher` does not expose as a configuration and would mean patching it, reopening the fork
[decision 0001](decisions/0001-fork-ripgrep-for-wasm.md) removed — or making the anchors agree with the
splitter, which is not a knob `crlf(true)` offers separately from its CRLF behaviour: the underlying regex
engine's `Look::EndCRLF`/`StartCRLF` are what they are. Bare-CR line endings are decades obsolete for text
files; the progress-bar case is real but the "line" a caller would want back from it is not obviously
well-defined either. Not obviously worth fixing. Pinned in the `documented_defects` module of
`packages/search/tests/search.rs` and in `Netgrep.integration.spec.ts`. Published in
[`guide/caveats.data.json`](guide/caveats.data.json) as `bare-cr-anchors`.

Found on 2026-08-05 during review of item 17's fix.

### 29. `grep` cannot be cancelled while it is finding nothing — `packages/netgrep/src/lib/grep.ts`

`grep` yields only on a hit, so across a stretch of file that matches nothing the consumer's loop body never
runs — and a `break` only exists to take once a hit has been yielded. Calling `.return()` on the iterator does
not help either: an async generator suspended inside an `await` queues the return request and honours it only
when the body next reaches a `yield`, which for a hitless stream is never. A file with no match therefore
downloads in full, and nothing the caller can write stops it.

Not a workaround away, which is why this is P1 rather than a nicety: the caller does not own the request.
The workload that reaches it is the demo's own — a debounced search box over 408.6 MB, issuing a fresh
`grep` every 300 ms of typing, each abandoned one still reading to the end of its file.

`GrepOptions` deliberately carries no `signal`: a top-level one would need a documented precedence rule
against the `signal` inside per-call `fetch` options, and those are **item 22** above, unsettled and deferred.
Item 22 is what closes this — an `AbortSignal` reaching `fetch` cancels a transfer no `break` can reach.
Not in [`guide/caveats.data.json`](guide/caveats.data.json), like the `grep` half of 3g: the published list
describes `Netgrep` only, until `grep`'s own consumer documentation lands.

Found on 2026-08-06 during review of the `grep` branch.

---

## P2 — Health

### 14. The `.wasm` is ~1.17 MB, up 12.6% from the 2022 build

1,038,608 → 1,169,300 bytes. Accounted for (dependency rows measured 2026-07-28, release builds through
`wasm-pack`):

| change | bytes |
|---|---|
| 2022 baseline (fork, `wasm-bindgen` 0.2.82, `wee_alloc`, inert profile) | 1,038,608 |
| modernized dependencies | **+341,949** |
| removing `wee_alloc` | +6,839 |
| moving `[profile.release]` to the workspace root | −155,469 |
| `codegen-units = 1`, `panic = 'abort'` | −76,166 |
| `search_bytes_line` and its line post-processing (item 19, 2026-07-30) | +15,769 |
| `search_bytes_line_ranges` and the UTF-16 offset pass (item 19's follow-up, 2026-08-01) | +4,609 |
| **net** | **+130,692** |

The bulk is upstream — newer `regex-automata` carries larger DFA and Unicode tables — and is not really
reducible without giving up the modern crates. Roughly 502 KB gzipped over the wire.

The demo's `StatsBar` states this number to visitors, so it moves when this does — see
[`../AGENTS.md` §2.3](../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it).

Remaining levers, none taken: `opt-level = 'z'` (a further ~27 KB, at some throughput cost in a
regex-scanning hot path); `wasm-opt -Oz`; disabling `grep-regex`'s Unicode support, which would change
matching behaviour and is out of scope.

### 15. `memmap2` is compiled into a browser binary

`grep-searcher` depends on `memmap2` **unconditionally** — it is not feature-gated, and the crate's only
features are deprecated no-ops, so `default-features = false` drops nothing. netgrep only ever calls
`search_slice`, never the mmap reader, so it is dead weight.

Removing it means patching `grep-searcher`, i.e. reintroducing the fork that was deleted in
[decision 0001](decisions/0001-fork-ripgrep-for-wasm.md). Not worth it. Recorded so it is not rediscovered.

### 26. The block path copies each matching line three times — `packages/search/src/lib.rs`

`search_block` copies every matching line's bytes three times before they cross the boundary:

```
lib.rs:518   mat.bytes().to_vec()                      # BlockSink, per hit
lib.rs:472   String::from_utf8_lossy(capped).into_owned()   # decode_line_with_ranges
lib.rs:152   text.push_str(&hit.line)                  # encode_block, into the joined buffer
```

**The first is forced and cannot be removed on its own.** `SinkMatch` does not outlive the callback — the
searcher reuses its internal buffer — so anything that defers processing has to copy. `LineSink` carries
the same constraint and the same comment.

**The copies are not the interesting cost; the intermediate is.** `BlockOutcome.hits` holds one `String`
and one `Vec<u32>` per hit, all alive at once, for the whole block before `encode_block` runs. That is a
smaller version of the eager materialisation that the flat `text`+`table` encoding exists to avoid, so
the design argument against `serde-wasm-bindgen` applies in miniature to netgrep's own intermediate.

The candidate fix is to **fuse the sink with the encoder**: give `BlockSink` the `&RegexMatcher`,
`max_line_bytes`, and the output `text`/`table` buffers, and encode inside `matched()` where
`mat.bytes()` is still valid. That removes the first and third copies and the intermediate entirely —
one copy per line, and peak memory O(output) rather than O(2 × output + 2N allocations). A smaller
variant removes only the second: `from_utf8_lossy` returns a `Cow` that is `Borrowed` for valid UTF-8,
which is nearly always, and `.into_owned()` allocates anyway; a consumer that pushed the `Cow` straight
into a buffer would not.

**Do not do either without measuring first.** [Decision 0016](decisions/0016-compiled-matcher-memo.md)
profiled this engine and found matcher *compilation* was 97–99% of the cost — the copies were not where
the time went. Nothing has profiled the block path, and `wee_alloc` is no longer in this crate, so
[decision 0008](decisions/0008-wee-alloc.md)'s assumptions about allocation cost no longer hold either.
The measurement wants a realistic workload, which means waiting until the streaming loop can drive it.

Fusing also has a real cost beyond the code: `try_search_block` returning a plain `BlockOutcome` is what
lets the sink and the encoding be reviewed and tested separately, and eight tests assert against that
shape. Weigh that against whatever the measurement shows.

### 27. The streaming loop never overlaps the network with the search — `packages/netgrep/src/lib/Netgrep.ts`

`handleReader` awaits `reader.read()`, searches what came back, then recurses (`Netgrep.ts:295-354`). The two
never run at the same time: the network sits idle while WebAssembly works, and WebAssembly sits idle while
the next chunk arrives. Issuing the next `read()` *before* searching the current block would overlap them.

Today the cost is small, because a search stops at the first match and most searches end early. It grows
once every block is searched to completion rather than short-circuited, which is the direction
[decision 0027](decisions/0027-streaming-matching-lines.md) takes the API.

**Do not do this without measuring.** The saving is bounded by however long the search actually takes
against however long a read takes, and nobody has measured either. If the network dominates — likely on the
files netgrep is aimed at — overlapping buys nothing. [Decision 0016](decisions/0016-compiled-matcher-memo.md)
is the precedent: it profiled this engine and found the cost was somewhere nobody expected.

**A property to preserve, and a reason this must stay bounded.** An async generator suspends at `yield` and
does not resume until the consumer asks for the next value, so a consumer that stops consuming stops the
reads, the response body's queue fills, and the browser stops draining the socket — backpressure reaches the
wire without any pause logic being written. That is a property of the shape rather than of any code here, and
it is worth not breaking: a lookahead of one block costs exactly one block of slack, while an unbounded
read-ahead queue would discard the property entirely and let a slow consumer buffer the file.

Backpressure has one thing it cannot do — hold a pause long enough that the connection times out. That wants
resuming by `Range` request instead, which is a feature and belongs in an issue rather than here.

---

## P3 — Papercuts

### 20. `NPM_TOKEN` is a long-lived credential — `.github/workflows/publish-*.yml`

Both publishes authenticate with a maintainer token stored as a repository secret, which does not expire
until someone rotates it. npm's **trusted publishing** replaces it with a short-lived OIDC token minted per
run, leaving no credential in the repository at all.

Deliberately deferred rather than done alongside release-please: the first release-please run was already the
largest release this repository has ever cut, and stacking a second new authentication mechanism onto it
would have made a failure ambiguous between the two. `provenance: true` shipped in the meantime, so the
tarballs already carry an attestation naming the workflow and commit that built them — this item is only
about removing the token.

Two things to establish before starting, neither of which is answerable from the docs: whether npm matches
the trusted publisher on the `workflow_ref` (top-level) or `job_workflow_ref` (reusable file) claim, and
whether the publish action performs the OIDC exchange at all. The answer to the first decides whether
`release.yml` or `publish-*.yml` is the registered publisher — and since only one can be, **it will break the
`workflow_dispatch` retry path for npm**, which exists precisely because a failed publish cannot be retried
by re-running `release.yml`.

### 22. `fetch` options are not passed through — `packages/netgrep/src/lib/Netgrep.ts`

`search` builds its own request and forwards only `signal` (`fetch(url, { signal: config?.signal })`), so a
URL needing an `Authorization` header, a cookie, or a non-default `mode` cannot be searched at all. It is not
a workaround away either: netgrep owns the fetch because it needs `res.body` to stream, so a caller cannot
hand it a `Request` or a response it made itself.

Named in [0025](decisions/0025-streaming-grep-over-http.md)'s *Rejected alongside* as a real ask deferred
rather than refused — and it bites hardest on exactly the files that record positions the project around,
which are the ones somebody else hosts. The design question is unsettled: accepting a `RequestInit` wholesale
is one line and hands callers `method` and `body`, neither of which means anything here and both of which
would then have to be documented as ignored or rejected; naming the fields netgrep supports keeps the surface
honest and makes every future field a change. Per
[`../AGENTS.md` §1](../AGENTS.md#1-what-this-project-is) it starts as an issue.

### 23. Chunk searching runs on the main thread — `packages/netgrep/src/lib/Netgrep.ts`

Every chunk is handed to the WASM matcher between paints, so a large file's search competes with rendering on
the same thread — the one workload the positioning in
[0025](decisions/0025-streaming-grep-over-http.md) invites. A worker would move it off, at the cost of
transferring chunks across the boundary, a second WASM instantiation per worker, and an abort path that has to
cross it too.

No consumer has reported it, and nothing visibly stuttered while the demo was being rebuilt and checked in a
browser on 2026-08-02. **But the demo has stopped being evidence against it.** It now puts 408.6 MB through
the matcher between paints over roughly 1.8 seconds, where the old 2.6 MB of stories was matched faster than a
frame — so this is a thing a visitor could plausibly notice rather than a note kept against rediscovery.
Still not planned: a worker is a widening and needs its own issue and record.

### 28. An expression-bodied `beforeEach` silently registers a teardown — `packages/netgrep/src/lib/*.spec.ts`

`beforeEach(() => mockFetch.mockReset())` returns the mock, and Vitest treats a function returned from a hook
as that hook's own teardown — so it *calls* the mock after every test, not just resets it before one. Invisible
until the mock's implementation has a side effect: in `grep.integration.spec.ts` the teardown invoked an
implementation that returned a rejected promise, producing an unhandled rejection that failed an unrelated test
with a bare `Error: offline`. Fixed there with a block body.

**This entry shipped with an inventory that was already false.** It named `Netgrep.spec.ts:745` as the one
remaining instance, while `streamBlocks.spec.ts:88` carried the exact `mockFetch.mockReset()` shape — in a file
added two commits before the entry was written, and harmless there only because that suite never leaves a
rejecting implementation in place for the teardown to invoke. Fixed with a block body on 2026-08-06.

`Netgrep.spec.ts:745` — `beforeEach(() => mockSearchLine.mockReturnValue('x'));` — is now the last, and is
harmless today only because calling that mock has no side effect. The rule: hook bodies in this repository use
braces. A count of instances in an entry like this one goes stale the moment a spec file is added, so the rule
is the durable half and the list is not.

---

# Done

Kept for the record, most recent first. Each says what was actually true, including where the original
analysis was wrong.

| # | Item | Outcome |
|---|---|---|
| 3f | A single NUL byte discards the whole searched block | **Fixed, 2026-08-05.** `BinaryDetection::quit(b'\x00')` never stopped *at* the NUL — it abandoned the entire block the searcher was handed, so a match was dropped even when it preceded the NUL and even when it sat on an earlier line, and a boolean cannot tell "binary, not searched" from "no match". `BinaryDetection::none()`. The entry's own analysis offered two options and this took the first; the second — surfacing the distinction — remains an API change and stays out of scope. The incidental narrowing [0018](decisions/0018-line-oriented-tail-buffer.md) introduced, where a NUL landing in the held-back partial line let the match survive, is no longer load-bearing but its assertion is kept: it now passes for the ordinary reason rather than the accidental one, and the two must not be told apart by chance. **The trade is real and is published as a caveat:** nothing now declines to search binary input, so a pattern occurring inside a `.png` is reported like any other match. Pinned in both `search.rs` and `Netgrep.integration.spec.ts` under decision [0011](decisions/0011-tests-that-assert-known-bugs.md)'s rule — inverted and renamed, not deleted. |
| 17 | `$` never matches on CRLF input | **Fixed, 2026-08-05.** `RegexMatcherBuilder::crlf(true)`, which the entry already named as the fix and correctly said wanted its own tested commit. **The ordering is the part the entry did not know:** `crlf` sets the matcher's line terminator to `\r\n` as well as enabling CRLF anchors, while `line_terminator` does not touch the anchor setting — so `.crlf(true)` must precede `.line_terminator(Some(b'\n'))` or the terminator moves off `\n` and takes the chunk splitter's invariant with it, since [0018](decisions/0018-line-oriented-tail-buffer.md) carries the incomplete trailing line between chunks precisely because a match can never span a `\n`. Reversed, this is not a silent wrong answer that ships unnoticed — the searcher's own line terminator stays `\n`, `grep-searcher` rejects that mismatch against the matcher's `\r\n` internally on every call, and although that rejection is itself discarded (`let _ = searcher.search_slice(…)`) rather than surfaced, its effect is not: measured directly, 49 of the crate's 58 tests fail immediately, because nearly every search comes back with no match. Loud enough for CI to catch before it reaches anything downstream, just not loud in the sense of naming its own cause. **`.multi_line(true)` turned out to be required too, and the entry did not anticipate it either:** a bare `$` parses to the same AST node as `(?m)$`, and the underlying `regex-syntax` crate only picks the CRLF-aware anchor over the absolute end-of-haystack one when multi-line mode is on, so `crlf(true)` alone left `$` compiling unchanged — the first attempt at this fix still failed its own inverted test. Pinned in `search.rs`, and newly pinned in `Netgrep.integration.spec.ts` — there was no TypeScript assertion, and decision [0011](decisions/0011-tests-that-assert-known-bugs.md) wants one, because what made this defect hard to notice is that it depends on who authored the file rather than on anything the caller did. |
| 24 | The demo could not demonstrate what the project claims | **Shipped, 2026-08-02** — see [0026](decisions/0026-demo-as-log-dashboard.md). Never an Open item: it was recorded in [0025](decisions/0025-streaming-grep-over-http.md)'s *Consequences* as a gap that record could not close itself, and it is here so the closure is on the list rather than only in a decision. The demo searched 56 files averaging 46 KB under a hero reading *on files your tab could never hold*, so the demo's own files were a standing counterexample to the claim above it, and an answer-before-the-last-byte on a file that arrives in two chunks is invisible. Four generated logs — 8.3, 40.0, 120.1 and 240.2 MB, 408.6 MB together — tiled from four committed ~512 KB CC BY 4.0 loghub-2.0 seeds into a gitignored `public/logs/`, served as `.txt` so Pages compresses them. Measured in a browser: an early match answers at ~16 ms while the 240 MB source still streams, all four settle at ~1.8 s, and a marker a quarter of the way into that source answers at ~467 ms against ~1.8 s for a full read of it. **Half the gap only.** Constant memory is still not demonstrated on the page and is not scheduled to be: no browser API gives an honest per-stream memory figure, so a number there would be a fabrication. — **Extended, 2026-08-03.** The clause that read *the page reports elapsed time and nothing else, because nothing else is honestly measurable from inside a tab* was wrong in its second half and is retracted. The page now also reports **bytes read per source and in total**, counted by wrapping the demo's own `window.fetch` and piping each log response through a counting `TransformStream` — a measurement at the page's own boundary, needing nothing from the library. Measured against the built site: a match near the head of Apache answers after **8.9%** of that file while the other three read 100%, `NETGREP-MARKER-25` lands at 25.0–32.3% across the four, `-75` at 75.0–78.1%, and a miss reads 100% of all of them. ⚠️ The figure is **decompressed file content, not wire bytes** — the logs are served gzipped at ~16× — so it is labelled *Scanned* and the stats bar says which it is; do not let that sentence be shortened away. Resource Timing was probed and cannot do this: an aborted fetch reports `encodedBodySize: 0` in Chromium, which is exactly the case worth showing. Two costs accepted: `pnpm dev` and `pnpm build:example` now depend on a ~0.8 s generation step, and the generated logs are repetitive by construction, so the four `NETGREP-MARKER-*` lines are their only deep needles. Made item **23** visible — see above. |
| 19 | The cache has no eviction, size cap or TTL | **Closed by deleting the cache**, not by adding eviction — see [0024](decisions/0024-remove-the-in-memory-cache.md). This was what remained of item **11** after [0018](decisions/0018-line-oriented-tail-buffer.md) fixed its O(n²) half. The eviction it asked for is the browser HTTP cache's, and always was: netgrep now retains nothing between searches, so there is no growth to bound. ⚠️ **This is the second item numbered 19** — see the note under *Item numbers are stable*, above. |
| 21 | Early resolution did not cancel the request | **Fixed.** `resolve()` on a match stopped issuing reads but left the request open, so the remaining bytes still arrived and were still paid for — the saving was latency only. `reader.cancel()` at the match site ends the transfer. Never an Open item on this list: it was recorded in [0002](decisions/0002-search-while-downloading.md)'s *Consequences* and nowhere else, which is why it went unclosed for years. Pinned by "cancels the response stream on a match, ending the transfer" in `Netgrep.integration.spec.ts`, with the stream-ends-normally control beside it. |
| 19 | Return the matching line alongside the boolean | **Shipped, and only because 3a landed first.** [Issue #19](https://github.com/dgopsq/netgrep/issues/19) proposed it against a `MemSink` that no longer existed — item 13 had already made it short-circuit, so the "closes 13 for free" argument was void and the sketch's ~10 lines were a diff already applied. What made it worth doing instead was [0018](decisions/0018-line-oriented-tail-buffer.md): before it, each chunk was searched alone, so a first occurrence straddling a seam was missed and the line returned was silently the file's *second* match, varying with how the network split the response. With whole lines delivered in order, the line is the file's first matching line under any chunking — pinned across six chunk sizes, and two searches of one url agree. Opt-in via a flag — `captureLine` then, `capture: 'line'` since 0022 — and a **second** WASM export so `search_bytes` is untouched and the boolean path allocates nothing, capped in Rust before the copy (`maxLineBytes`, default 4096), terminator stripped, decoded lossily. The flag's effect is in the type: no `line` key at all when off, and `result` is a discriminant when on. Left a residual in **3g** — inside an over-long line the "line" is a fragment. `.wasm` +15,769 bytes. 16 Rust tests, 20 TypeScript. See [0020](decisions/0020-the-matching-line.md), which also names the match details refused alongside it. Each match's position *within* that line shipped a day later as `capture: 'line-ranges'`, a third export on the same pattern — [0022](decisions/0022-capture-ranges.md), which reopened 0020's refusal of highlight ranges because its stated reason (re-run the pattern in JS) cannot reproduce smart case. |
| 18 | Concurrent searches of one url both fetch | **Fixed, for cache-on instances only — and that is the whole design rather than a shortcut.** A per-url registry of in-flight searches; a second caller of the same url waits on the first and answers from the entry it writes. The entry *is* the handover, so with the cache **off** there is nothing to hand over: sharing would mean either retaining every chunk of a file nobody asked to keep — the cost [0018](decisions/0018-line-oriented-tail-buffer.md) had just removed — or teeing the response stream and with it the first caller's abort signal. So with the cache off both callers still fetch, deliberately, and a test pins it. Two more residuals, both pinned: a first caller that matches early resolves without draining, writes no entry, and its waiter fetches after all — one saved request is the common case, not a guarantee; and a failed download is not inherited by its waiter, which retries with its own signal. `searchBatch` and `searchBatchWithCallback` inherit the de-duplication for free, since both go through `search`. The demo is untouched: it runs with the cache off on purpose, because the page measures the network. See [0019](decisions/0019-in-flight-fetch-registry.md). — **Reopened in substance and accepted, 2026-08-01.** [0024](decisions/0024-remove-the-in-memory-cache.md) removed the cache, and the entry *was* the handover — so the registry went with it and two concurrent searches of one url both fetch again. That is now a design consequence rather than a defect: the caveat's `kind` moved from `defect` to `by-design`, the assertion moved out of the `documented defects` block into the ordinary suite, and the item stays here rather than returning to Open. |
| 3a | Chunk-boundary false negatives | **Fixed, and the design question in [issue #20](https://github.com/dgopsq/netgrep/issues/20) had a wrong premise.** That issue said the tail size must be a configured cap because the maximum match length of an arbitrary regex is not derivable from the pattern. True — but it is derivable from the *data*: a match can never span a `\n`, because grep-regex strips the terminator out of character classes and rejects patterns containing a literal one. So the exact carry-over is the incomplete trailing **line**, and no cap is needed for correctness. `MAX_TAIL_BYTES` (64 KB, not configurable) exists only so a line with no terminator cannot buffer a 500 MB response; past it the tail degrades to a byte window, which is item **3g**. Fixing it also removed the never-tracked mirror-image false *positives*, where a seam looked like a line start to `^` and a line end to `$`. Early resolution became line-granular, which costs two extra reads in one test and nothing against real 16–64 KB chunks. Four assertions inverted. See [0018](decisions/0018-line-oriented-tail-buffer.md). |
| 3b | Poisoned partial cache | **Fixed, and it had to ship with 3a.** Not for the reason recorded here — "a naive fix drains the stream" is a shared failure mode of bad fixes, not a coupling. The real one: 3a was *suppressing* early resolution, so closing it alone would have left more searches resolving early, more prefixes cached, and a regression in the default configuration. The fix is smaller than the completeness flag this entry proposed: write the entry only when the reader reports `done`, so a partial one is never created. A partial entry cannot resume a download either, and nothing needed it to. Note a match in the *final* chunk still caches nothing — `done` is one read later. |
| 11 | `upsertMemoryCache` is O(n²) | **Fixed** as a side effect of 3b, because "collect chunks and join once" is what deferring the write requires. Chunks are also only collected when the cache is *on*, so a search with it off no longer retains the whole file — it had been paying the memory cost for a cache it was not using. The no-eviction half of this entry went unfixed and became item **19**, which [0024](decisions/0024-remove-the-in-memory-cache.md) closed by deleting the cache outright. |
| 3c | Panic on invalid pattern | **Fixed.** `search_bytes` returns `Result<bool, JsError>`, so a stray `(` — or a literal newline, which the `\n` line terminator forbids — is a rejected promise carrying the regex crate's own diagnostic instead of `RuntimeError: unreachable`. The generated TypeScript signature did not change, so `Netgrep.ts` needed no edit. The engine is now split into a plain-Rust `try_search_bytes` and a two-line wasm wrapper, because `JsError` cannot be constructed on a native target and the Rust suite runs natively. Three assertions inverted. See [0016](decisions/0016-compiled-matcher-memo.md). |
| 12 | Regex recompiled per chunk | **Fixed, and it was not a papercut.** A one-entry `thread_local` cache of the last compiled pattern; compile failures cached alongside successes. Over 800 16 KB chunks: a literal 91.2ms → 2.2ms, a Unicode class 2.9s → 20.6ms. Compilation was **97–99% of the total cost**, not the P3 nuisance this entry called it. The compiled-matcher *handle* this entry recommended was considered and rejected — it puts `.free()` on four exit paths of a promise executor and breaks a package whose whole surface is one function. See [0016](decisions/0016-compiled-matcher-memo.md). |
| 13 | `MemSink` does not short-circuit | **Fixed.** `Ok(false)` stops at the first match; `match_count: u64` became `found: bool`. On chunks where every line matches, 16.4ms → 1.3ms at 16 KB and 61.9ms → 1.8ms at 64 KB; neutral on a single late match. Behaviourally unobservable — all 59 tests pass either way — so measurement is the only evidence it does anything. |
| 2 | `pnpm test:wasm` fails on a fresh machine | **Fixed by removing the harness.** ChromeDriver was versioned independently of the browser it drove, by a mechanism this repo did not control, so the mismatch was structural. Playwright now runs the browser tests with a Chromium pinned to its own package version, the Rust tests became a native `cargo test` (`pnpm test:rust`), and browser coverage went *up* — 2 assertions about pure byte logic replaced by the 17-test integration suite, which now also exercises the fetch-based loader. See [0013](decisions/0013-playwright-for-browser-tests.md). |
| 16 | Published package did not work under Vite | **Fixed.** Shipped wasm-pack's `web` target; the `bundler` target failed *silently* under Vite, returning `false` for every search. Verified in real Chrome against Vite (no plugins), webpack (no config), and a fresh app installed from the actual tarballs. See [0005](decisions/0005-esm-only-distribution.md). |
| 10 | Root depended on its own published packages | **Fixed** by pnpm workspaces. The example now bundles local source. This was the repository's headline gotcha. See [0009](decisions/0009-pnpm-workspaces.md). |
| 9 | `@netgrep/search` version drift unenforced | **Fixed.** `workspace:*` plus `post_build.js` copying the version from `Cargo.toml`; `verify:pack` asserts it. |
| 8 | Stale CI actions | **Fixed.** `actions/checkout@v4`, `actions/setup-node@v4`, archived `actions-rs/toolchain` → `dtolnay/rust-toolchain`, plus `Swatinem/rust-cache` and a pinned wasm-pack action. |
| 7 | `ts-jest` 28 vs `jest` 29 mismatch | **Moot.** Both removed; replaced by Vitest. See [0010](decisions/0010-vitest-and-biome.md). |
| 6 | Nx 14.5.4 / `@nrwl/*` → `@nx/*` | **Removed, not migrated**, along with `@nxrs/cargo` — nine packages. See [0007](decisions/0007-nx-cargo-hybrid-monorepo.md) and [0009](decisions/0009-pnpm-workspaces.md). |
| 5 | `wee_alloc` unmaintained | **Removed, and the assumption was wrong.** Measured at 6,839 bytes — 0.6%. Modern `rustc` closed the gap. Same measurement revealed `[profile.release]` had never been applied at all. See [0008](decisions/0008-wee-alloc.md). |
| 4 | `wasm-bindgen` 0.2.82 → current, drop the ripgrep fork | **Done together**, 0.2.126 + the three `grep-*` sub-crates from crates.io, Rust 1.97.1. The "mutually exclusive" constraint recorded here was an artifact of the old pins. `lib.rs` changed by two import lines; `Cargo.lock` lost 21 crates. See [0001](decisions/0001-fork-ripgrep-for-wasm.md). |
| 3e | `^` anchored to the chunk, not the line | **Fixed upstream, for free**, by item 4 — no `lib.rs` change needed. Caught only by the defect-pinning test; see [0011](decisions/0011-tests-that-assert-known-bugs.md). |
| 3d | No test exercised the real engine through the TypeScript API | **Fixed.** `Netgrep.integration.spec.ts` drives the real WASM through the real streaming loop, loading the artefact that actually ships. |
| 1 | CI could not build the Rust package | **Fixed.** `rust-toolchain.toml` said `channel = "stable"`, so Rust 1.82's wasm C ABI change broke every push touching Rust. Pinned — a version move is now a reviewable commit rather than something that happens to you. |
