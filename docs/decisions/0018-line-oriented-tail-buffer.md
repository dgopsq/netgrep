# 0018 — Retain the incomplete trailing *line* between chunks, and cache only a drained stream

**Status: ACCEPTED (2026-07-30).** Closes [`BACKLOG`](../BACKLOG.md) items **3a**, **3b** and **11**, narrows
**18**, and records why the fixed byte cap proposed in
[issue #20](https://github.com/dgopsq/netgrep/issues/20) was not the design taken. **Amended by
[0024](0024-remove-the-in-memory-cache.md)** (2026-08-01), which deleted the cache this record narrowed, and by
**[0027](0027-streaming-matching-lines.md)** (2026-08-06), which moved the loop off `Netgrep.search` and
answered this record's open question about issue #3 differently than it predicted. The tail-buffer decision
itself is untouched by both.

## Context

`Netgrep.search` handed the engine one `fetch` chunk at a time, with no overlap between them ever:

```ts
const u8Array = new Uint8Array(value);
const result = search_bytes(u8Array, pattern);
```

So a match straddling the seam between two chunks was not found — item **3a**. It was the worst shape a defect
can take here: it returned `false`, which is indistinguishable from a genuine no-match, and *which* chunk a
match landed in was decided by how the network split the response, so the same query against the same file
could answer differently twice. Risk scaled with the number of boundaries, which meant it was worst on exactly
the large files netgrep is otherwise the right tool for.

The obvious fixes are all worse. Draining the stream before searching destroys resolve-on-first-match, which
[decision 0002](0002-search-while-downloading.md) says is the entire point of the project. So the fix had to
retain a bounded overlap and keep searching as bytes arrive.

## Considered: a configured byte cap (issue #20)

The issue proposed retaining a fixed number of bytes from each chunk:

```ts
const TAIL = config?.maxMatchBytes ?? 1024;
tail = buf.subarray(Math.max(0, buf.length - TAIL));
```

Its reasoning for a cap was that the maximum match length of an arbitrary regex is not derivable from the
pattern — `.*`, `a{1,10000}` and `(foo|bar)+` have no useful bound, and the `regex` crate does not expose one.
True as far as it goes, and it makes the guarantee permanently conditional: *matches up to N bytes are never
missed at a boundary; longer ones may still be.* The issue was candid that this "does not actually fix the bug,
it bounds it", and that `maxMatchBytes` would be a hard option to document because explaining it requires
explaining the residual defect.

**The premise was wrong, though.** The bound is not derivable from the pattern, but it does not have to be:
it is derivable from the *data*.

## The invariant this rests on

A match can never span a `\n`. `packages/search/src/lib.rs` builds its matcher with
`line_terminator(Some(b'\n'))` and its searcher without multi-line mode, and grep-regex enforces that in both
directions — it strips the terminator out of character classes, and it *rejects* any pattern containing a
literal one:

```
"alpha.beta"          => false     "alpha\nbeta"    => Err("the literal \"\\n\" is not allowed in a regex")
"(?s)alpha.beta"      => false     "alpha\\nbeta"   => Err(same)
"alpha[^x]beta"       => false     "alpha\\x0abeta" => Err(same)
"alpha[\\s\\S]beta"   => false
```

So the largest unit a match can occupy is one line, and **the exact carry-over between two chunks is the
incomplete trailing line** — no guess required.

This invariant is now asserted, with all of the escape hatches above, by
`test_a_match_cannot_span_a_line_terminator` in `packages/search/tests/search.rs`. That test carries a comment
naming `splitAtLastLine` as its dependant, because the failure mode is nasty: if a dependency bump let a
pattern match across a newline, 3a would silently come back and **no JavaScript test would notice**.

## Decision

`splitAtLastLine(buffer, cap)` divides the retained tail plus the new chunk into the part that is whole lines
and the part that has to wait:

```ts
let cut = buffer.lastIndexOf(LINE_FEED) + 1;      // 0 when no line has completed
const windowed = buffer.length - cut > cap;
if (windowed) cut = buffer.length - cap;

return {
  searchable: windowed ? buffer : buffer.subarray(0, cut),
  tail: buffer.subarray(cut),
  tailSearched: windowed,
};
```

The streaming loop keeps `tail`, searches `searchable` when it is non-empty, and searches the leftover tail when
the reader reports `done` — at which point it is a genuine final line rather than a fragment.

`tailSearched` is why the flush is conditional. When windowed, `searchable` is the whole buffer and therefore
already covered the retained bytes, so flushing them again would both rescan up to `cap` bytes and — because a
windowed tail begins mid-line — let `^` match at its first byte.

`MAX_TAIL_BYTES` is **64 KB and not configurable**. It is a safety valve, not a tuning knob: without it a
single line with no terminator would buffer an entire 500 MB response. One contract is easier to document than
a family of them, and the public surface is deliberately small ([`AGENTS.md` §1](../../AGENTS.md#1-what-this-project-is)).

| input | regime | guarantee |
|---|---|---|
| every line under 64 KB — all prose, Markdown, source | line tail | **a chunk boundary is invisible**: it neither hides a match nor invents one |
| a line over 64 KB — minified JS, a single-line dump | 64 KB byte window | a match shorter than 64 KB is never hidden, but a longer one may be, and `^` may match at a window edge (item **3g**) |

The measurement the issue asked for: the demo corpus is 2.6 MB over 54,496 lines, and its longest line is
**76 bytes** — every one of the 56 files maxes out between 74 and 76. The ceiling has 862× headroom there, and
costs nothing to set generously, because a line tail retains the actual partial line rather than a fixed
window. That is the economic difference from the issue's design, where `TAIL` bytes are retained *and rescanned*
on every chunk of every file.

### Two things that fall out for free

**`^` and `$` stop lying at boundaries, for any line under the ceiling.** Because each chunk was searched as
though it were a whole document, the seam looked like a line start to `^` and a line end to `$`, so both
invented matches — the mirror image of 3a, never separately tracked, and just as network-dependent:

```
serve(['hello won', 'derful world'])   ~ 'won$'     ->  true    # before
                                       ~ '^derful'  ->  true    # before
```

Handing the engine only complete lines fixes both directions at once, *while there are complete lines to hand
it*. A windowed tail starts mid-line and there is no way to tell the engine so, so `^` anchors to the window's
first byte — a false positive with the same precondition as 3g's false negative, and now pinned beside it. The
first version of this change made it worse by also searching the windowed tail alone at end of stream, which
turned a single-chunk newline-free file into a false positive; `tailSearched` removes that case.

**Every byte is scanned exactly once — in the line regime.** The issue noted that re-searching a byte-window
tail means a match wholly inside it is found twice: harmless for a boolean, but a problem if
[issue #3](https://github.com/dgopsq/netgrep/issues/3) (return the matching line) ever lands, since the same
line could be reported from two chunks. Complete-line blocks do not overlap, so that is designed out there.

It does **not** hold once a line outgrows the ceiling: `searchable` is then the whole buffer *and* the last
`cap` bytes are retained, so those bytes are scanned again in the next buffer. The end-of-stream flush no longer
adds a third pass over them — `splitAtLastLine` reports `tailSearched` and the loop skips a tail it has already
seen — but within the windowed regime the overlap is inherent. #3 would have to handle it.

## And the cache, because 3a could not ship without it

`AGENTS.md` §7 and the backlog both say 3a and 3b interact. The stated reason — that a naive fix to either
drains the stream — is a shared failure mode of bad fixes, not a coupling. The real coupling is sharper:

**fixing 3a makes 3b worse.** 3a was *suppressing* early resolution. A search whose match straddled a boundary
missed, so it drained the stream and cached the whole file, harmlessly. Once boundaries stop hiding matches,
more searches resolve early, and every early resolution left a cache entry holding only the prefix it happened
to read, unmarked as incomplete — so a later search for a term further down the same file answered `false`
about text that had never been downloaded. The cache is **on by default**, so 3a alone would have shipped a
regression to the default configuration.

The fix is to write the entry **only when the reader reports `done`**, which is less code than the per-chunk
upsert it replaces:

```ts
private commitMemoryCache(url: string, chunks: Array<Uint8Array>) {
  if (!this.config.enableMemoryCache) return;
  this.memoryCache[url] = concatBytes(chunks);
}
```

A partial entry is never created, rather than created and flagged. This is a narrower fix than the completeness
flag the backlog proposed — a partial entry cannot resume a download either — and it costs a re-fetch where
there used to be a wrong answer.

It also closes two more:

- **Item 11** (`upsertMemoryCache` is O(n²)): collecting chunks and joining once is exactly what that item
  asks for. Chunks are collected *only when the cache is on*, so a search with it off no longer needs to hold
  more than the tail.
- **The sharp half of 18**: the entry is now assigned from a complete file rather than appended to per chunk,
  so two concurrent searches overwrite each other with identical bytes instead of joining the file to itself
  and forming a line that exists in no file. The duplicate *fetch* is untouched and 18 stays open; it wants the
  per-url promise registry, which this change did not add.

## Consequences

**Early resolution is line-granular, not chunk-granular.** A chunk with no terminator in it searches nothing
and grows the tail. Against real 16–64 KB `fetch` chunks this is invisible — a line completes inside the chunk
it starts in. Against the deliberately tiny chunks in the test suite it is visible and asserted:
`stops reading as soon as a line matches` reads three of POEM's eight 16-byte chunks rather than one, because
the poem's 34-byte first line only completes in the third.

**Newline-free input is slower to answer.** Today's code searched every chunk of a minified file; this buffers
up to 64 KB before the first search. Not a wrong answer — the end-of-stream flush catches a file smaller than
the ceiling — just a later one, for the input shape netgrep is least aimed at.

**A rejection after the first chunk now settles the promise.** The recursive `handleReader` call was not
chained to the promise the executor was handed, so a rejection from any chunk after the first — a connection
dropped mid-stream, an abort, an invalid pattern first reaching the engine on a later chunk — was an unhandled
rejection and the search never settled at all. Pre-existing, and unreachable for pattern errors because those
fail identically on chunk one. It stopped being unreachable here: a newline-free multi-chunk stream searches
nothing until the flush, so an invalid pattern would first throw on the `done` path, which is always reached
through a recursive call. Fixed with `.catch(reject)` rather than by returning the promise, which would retain
a nested chain one deep per chunk.

## What this does NOT fix

**A single match longer than 64 KB, split across chunks.** Past the ceiling the tail is a plain window on the
last 64 KB, so a match starting before that window and ending after the buffer is lost. It needs one line
longer than 64 KB *and* a match spanning most of it, which no hand-written text produces. Pinned by
`BACKLOG 3a (RESIDUAL)` in `Netgrep.integration.spec.ts`, which also asserts the control case — the same match
arriving in one chunk **is** found, because the buffer is searched whole before the window is taken. Getting
that wrong turns the residual into a regression, and it is the one part of `splitAtLastLine` that is easy to
write backwards.

Deliberately **not** given a caveat on the demo site, for the same reason item 17 has none: the corpus's
longest line is 76 bytes, so no query on that page can reach it. Recorded in the comment block of
`limitations.tsx` so it reads as a decision rather than an omission.

**Item 3f (a NUL discards the block) is not fixed, and its blast radius changed shape.** What the engine is
handed is no longer the network chunk but the block of complete lines in it, so how far a NUL reaches now
depends on where the last `\n` falls rather than on where the network split the response. A match on an
earlier line survives *if* the NUL happens to sit in the held-back partial line. That is incidental, not a
fix, and both behaviours are pinned so the difference is not mistaken for one. 3f is fixed in `lib.rs` or not
at all.

**Item 18's duplicate fetch**, and therefore the demo's cache, which stays off — see
[0006](0006-in-memory-cache.md) and the note in `use-corpus-search.ts`. The reason it stays off changed
though: not because the cache is unsafe, which it no longer is, but because a warm cache stops the page's
timings measuring the network, which is the one thing that page exists to show.

---

## Outcome (2026-08-01) — the cache this record narrowed is gone

See [0024](0024-remove-the-in-memory-cache.md). Item 18's duplicate fetch was closed the same day this record
shipped, by [0019](0019-in-flight-fetch-registry.md), and has since been reopened and accepted: with no
entry there is nothing to hand a second caller, so both fetch, by design.

The paragraph above about "the demo's cache, which stays off" describes a flag that no longer exists. Its
point survives without it — the page's timings are network timings — and is now true by construction rather
than by configuration, since the library retains nothing a repeat query could be answered from.

This record's own decision is untouched. The tail buffer is what it was; only the second half of its title,
*and cache only a drained stream*, has stopped describing anything.

---

## Amendment (2026-08-06) — the loop moved, and #3 did not handle the overlap

[0027](0027-streaming-matching-lines.md) replaced the `Netgrep` class with `grep()` and `matches()`, and this
PR deleted the class. **`splitAtLastLine` is unchanged, `MAX_TAIL_BYTES` is unchanged, and the guarantee table
above holds exactly as written.** What moved is the loop that drives it: every sentence attaching this
decision to `Netgrep.search` and `handleReader` should be read against `streamBlocks.ts`, which both `grep()`
and `matches()` consume. There is now one loop where the record describes one method, which is the same shape
with a different name.

Two passages are wrong rather than merely relocated.

**The prediction about issue #3 did not come true.** *"Harmless for a boolean, but a problem if issue #3
(return the matching line) ever lands, since the same line could be reported from two chunks"*, concluding
*"#3 would have to handle it."* #3 has landed, as `grep()`, and it **did not handle it**: inside a line past
the 64 KB ceiling a hit is yielded once per window pass — three times on the pinned fixture — and the
file-absolute line base gains a line at every window slide. Both are pinned as consequences of BACKLOG **3g**
rather than fixed, and deliberately: suppressing the repeat would drop the hit outright when a stream ends
inside such a line, and for a grep a lost hit is worse than a repeated one. The windowed tail, once searched,
is never re-searched at end of stream, so no later pass could correct the count either. The paragraph's
reasoning was right; only its conclusion about who would pay is not.

**The residual's pin moved, and changed name with it.** *"Pinned by `BACKLOG 3a (RESIDUAL)` in
`Netgrep.integration.spec.ts`"* names a test in a deleted file. The residual is unchanged and is now
`BACKLOG 3g: a match longer than 64 KB across a chunk boundary answers false` in
`matches.integration.spec.ts` — filed under 3g, which is where this record already said the residual lives. It
still carries both controls the paragraph insists on: the same match arriving in **one** chunk is found,
because the buffer is searched whole before the window is taken, and the same boundary with the line under the
ceiling answers true. Getting the first of those backwards still turns the residual into a regression.

Three passages are out of date in a way worth naming rather than editing:

- The measurement the issue asked for — *"the demo corpus is 2.6 MB over 54,496 lines, and its longest line is
  **76 bytes**"* — describes the story corpus [0026](0026-demo-as-log-dashboard.md) deleted. The demo is now
  408.6 MB of generated logs whose longest line, across all four sources, is 387 bytes. The point survives with
  a smaller multiple: 64 KB still has ~169× headroom over the worst line the demo can produce, and the economic
  argument against a rescanned fixed window is unaffected.
- *"Deliberately not given a caveat on the demo site… Recorded in the comment block of `limitations.tsx`"* was
  already stale before this PR: the demo no longer carries its own filtered limitation list, and 3g's
  consequences are published once in `guide/caveats.data.json`.
- *"Item 18's duplicate fetch, and therefore the demo's cache, which stays off"* was overtaken by 0024 and is
  addressed in the *Outcome* above; it is named again here only so a reader arriving at the bottom of this
  record does not have to reconstruct which of the two notes covers it.
