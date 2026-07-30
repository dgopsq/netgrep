# 0018 — Retain the incomplete trailing *line* between chunks, and cache only a drained stream

**Status: ACCEPTED (2026-07-30).** Closes [`BACKLOG`](../BACKLOG.md) items **3a**, **3b** and **11**, narrows
**18**, and records why the fixed byte cap proposed in
[issue #20](https://github.com/dgopsq/netgrep/issues/20) was not the design taken.

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
const overflowing = buffer.length - cut > cap;
if (overflowing) cut = buffer.length - cap;

return {
  searched: overflowing ? buffer : buffer.subarray(0, cut),
  tail: buffer.subarray(cut),
};
```

The streaming loop keeps `tail`, searches `searched` when it is non-empty, and searches the leftover tail once
when the reader reports `done` — at which point it is a genuine final line rather than a fragment.

`MAX_TAIL_BYTES` is **64 KB and not configurable**. It is a safety valve, not a tuning knob: without it a
single line with no terminator would buffer an entire 500 MB response. One contract is easier to document than
a family of them, and the public surface is deliberately small ([`AGENTS.md` §1](../../AGENTS.md#1-what-this-project-is)).

| input | regime | guarantee |
|---|---|---|
| every line under 64 KB — all prose, Markdown, source | line tail | **a chunk boundary never hides a match** |
| a line over 64 KB — minified JS, a single-line dump | 64 KB byte window | a match shorter than 64 KB is never hidden |

The measurement the issue asked for: the demo corpus is 2.6 MB over 54,496 lines, and its longest line is
**76 bytes** — every one of the 56 files maxes out between 74 and 76. The ceiling has 862× headroom there, and
costs nothing to set generously, because a line tail retains the actual partial line rather than a fixed
window. That is the economic difference from the issue's design, where `TAIL` bytes are retained *and rescanned*
on every chunk of every file.

### Two things that fall out for free

**`^` and `$` stop lying at boundaries.** Because each chunk was searched as though it were a whole document,
the seam looked like a line start to `^` and a line end to `$`, so both invented matches — the mirror image of
3a, never separately tracked, and just as network-dependent:

```
serve(['hello won', 'derful world'])   ~ 'won$'     ->  true    # before
                                       ~ '^derful'  ->  true    # before
```

Handing the engine only complete lines fixes both directions at once.

**Every byte is scanned exactly once.** The issue noted that re-searching a byte-window tail means a match
wholly inside it is found twice — harmless for a boolean, but a problem if
[issue #3](https://github.com/dgopsq/netgrep/issues/3) (return the matching line) ever lands, since the same
line could be reported from two chunks. Complete-line blocks do not overlap, so that is designed out rather
than deferred.

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
