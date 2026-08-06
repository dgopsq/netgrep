# 0022 — Match ranges within the returned line

**Status:** Accepted. **Amends [0020](0020-the-matching-line.md)** twice over: it reopens that record's
"Highlight ranges" rejection, and it replaces `captureLine: boolean` with
`capture: 'line' | 'line-ranges'`.
**Amended by [0027](0027-streaming-matching-lines.md)** (2026-08-06): half of that stands and half is
superseded. Ranges are still engine-derived UTF-16 offsets into the line — now on every hit, unconditionally —
but `capture` is deleted along with the flag it renamed, so the second half of this record's decision has
nothing left to describe. See the amendment at the bottom.

No issue preceded this one — unlike 0020, the argument was made in a written design, reviewed and agreed
before any code was written. The friction AGENTS.md §1 asks for was paid there.

## Context

0020 shipped the first matching line and refused highlight ranges in one sentence: *"Offsets by another name,
and the caller can re-run the pattern against a line it now has."* Both halves are worth separating, because
only the first survives.

**The second half is wrong in practice.** The engine is Rust's [`regex`](https://docs.rs/regex/) crate with
`case_smart(true)`. A caller re-running the pattern in JavaScript has neither: `RegExp` is a different syntax
— it rejects `[[:alpha:]]` and `(?x)`, and accepts backreferences and lookaround the Rust crate refuses — and
it has no notion of smart case, so `sherlock`, which the engine matched case-insensitively, re-matches
case-sensitively and highlights nothing. The highlight would
disagree with the answer above it, on the one screen where a user can see both. There is no way for a consumer
to reproduce netgrep's matching except to be netgrep.

**The first half is untouched.** The ranges here are *not* file offsets. They are produced by the same
compiled matcher, run over the line the engine already holds, after the search has ended — no position
bookkeeping crosses a chunk, and nothing about early exit changes. 0020's real objection was to offsets
*relative to the file*, which mean tracking a running position through the tail buffer and the windowed case,
fighting [0002](0002-search-while-downloading.md). Those stay refused, below.

So the rejection is reopened on a narrow ground: the ranges are engine-derived rather than re-derived, and
they are relative to a string the caller already has.

## Decision

```ts
const output = await NG.search(url, 'Sherlock', undefined, { capture: 'line-ranges' });
if (output.result) {
  output.ranges.map((r) => output.line.slice(r.start, r.end)); // the matched text
}
```

Four choices carry the weight.

**A third export, not a changed one.** `search_bytes_line_ranges(chunk, pattern, max_line_bytes) ->
Option<LineWithRanges>` sits beside the two 0020 left, and those two are byte-for-byte what they were. All
three share the compiled-matcher memo of [0016](0016-compiled-matcher-memo.md) through `with_matcher`, and one
`build_searcher`, so binary detection and matching semantics cannot drift between them — a divergence there
would be a difference in `result`, not merely in what comes back beside it. Each mode therefore pays its own
cost and only its own: the membership path still allocates nothing and copies no string, and that is a
property of which function is called rather than a claim about a flag.

**`capture` replaces `captureLine`, and there is no alias.** A breaking rename, shipped days after the flag it
renames. The alternative was a second boolean, `captureRanges`, which needs no rename at all — and that is
precisely why it was rejected: two booleans make four states, one of which (`captureRanges` without
`captureLine`) is meaningless and would have to be typed out of existence, and both would then be threaded
into the result-type generics *forever*. The union has one input and three states, all of them real. The cost
of the rename is bounded and paid now — the flag has been on npm for days, on an experiment whose README opens
by saying not to build on it — and the cost of the boolean pair is unbounded and paid by every future reader
of the types. `capture` also has room for a mode 0020's boolean did not.

**Ranges are UTF-16 code units into the returned line.** `line.slice(start, end)` is the contract, and it
holds with no conversion on the JavaScript side, which is the only reason to prefer them over the byte offsets
the engine natively produces. The conversion runs in Rust against the **decoded, truncated** string, in that
order: converting against the input bytes would be wrong wherever lossy decoding substitutes `U+FFFD`, since
an invalid byte and the replacement character have different lengths. Across the boundary the shape is the
line plus a flat `Uint32Array` of `[start, end, start, end, …]` — the cheapest thing to cross — which the
wrapper unflattens into `{ start, end }` pairs.

**`find_iter` runs over the whole stripped line, then ranges are clipped to the cut.** Not over the truncated
line, which would be cheaper and wrong: `$` would match at the truncation edge and report a match that is not
at the end of anything. Matching over the full line and then dropping ranges that fall entirely past the cut
(clamping one that straddles it) keeps the ranges answering the same question the boolean did.

## Consequences

- **`ranges` can be `[]` on `result: true`.** Every match can fall past the `maxLineBytes` cut — the line
  matched at byte 4500, the default cap is 4096 — and the same thing happens for a different reason inside a
  line longer than 64 KB, where the returned "line" is a fragment starting at an arbitrary byte (backlog 3g)
  and need not contain the match at all. `result` stays correct in both. The type is `NetgrepMatchRange[]`;
  consumers must not assume `length >= 1`. The cut case is pinned in both suites
  (`test_a_match_past_the_cap_is_dropped`, and "drops ranges past the maxLineBytes cut" in
  `Netgrep.integration.spec.ts`); the 3g fragment is pinned for `capture: 'line'` only, since reaching it
  needs a 70 KB line and it degrades the same way.
- **A match on an empty line is `line: ""` with `ranges: [{ start: 0, end: 0 }]`.** An empty range on an empty
  string, and both are falsy-adjacent — 0020's sharpest edge, unchanged and now with a second face. Branch on
  `result`, never on `line` or on `ranges.length`.
- **A breaking change in a 0.x minor.** `bump-minor-pre-major` caps it there, and the removal is recorded in
  the commit body as a `BREAKING CHANGE:` footer, so the changelog carries the migration —
  `captureLine: true` → `capture: 'line'` — rather than leaving it to a README nobody re-reads.
- **The `.wasm` grew 4,609 bytes** (1,164,691 → 1,169,300, +0.4%), which moves the rounded figure the demo
  states from 1.16 MB to 1.17 MB. Backlog 14's table is updated.
- **The published demo highlights the matches**, which is the visible proof the feature works, and `CAVEATS[0]`
  is retitled from "No ranking, no positions" to "No ranking". Required by
  [AGENTS.md §2.3](../../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it):
  positions within the line now exist, and a page whose only value is accuracy cannot go on denying them. It
  is the second retitle of that caveat — it read "One boolean per file" until 0020.

## Rejected alongside

0020's table, minus the row this record reopens. Each keeps its original reason, and each reason still holds:

| Ask | Why not |
|---|---|
| **Line numbers** | Requires counting terminators across every chunk, including ones early exit never reads. The count would be of *searched* lines, not file lines, so it would be wrong in exactly the cases anyone would check. |
| **File-absolute byte offsets** | Offsets are relative to the block handed to the engine, not the file. Making them absolute means tracking a running position through the tail buffer and the windowed case, which is bookkeeping that fights [0002](0002-search-while-downloading.md). The ranges this record adds are relative to a 4 KB string in hand and need none of it. |
| **Match counts** | Directly contradicts the short-circuit: counting means scanning the whole file, which is early exit deleted. Measured at 16.4ms → 1.3ms in [0016](0016-compiled-matcher-memo.md), in the wrong direction. |
| **All matching lines** | Same objection, plus an unbounded result size per file. |
| **Context lines (`-A`/`-B`)** | Needs lines the block may not contain — the preceding line can be in the previous chunk, already discarded. |
| **Ranking** | netgrep has no term statistics, no document frequencies and no index. There is nothing to rank *with*. The honest answer stays "use an index". |

**One row reopening is not precedent for the rest.** It was reopened because its stated *rationale* was false —
a JS re-match cannot reproduce the engine — not because a refusal expires after two records. The rows above
are refused for reasons that are still true, and the way to reopen one is to show its reason wrong, not to
point at this record.

---

## Amendment (2026-08-06) — `capture` is deleted, and the ranges are unconditional

[0027](0027-streaming-matching-lines.md) replaced the `Netgrep` class with `grep()` and `matches()`, and this
PR deleted the class, the `capture` option and the `NetgrepResult` types. The half of this record's decision
that is about **ranges** survives entirely: they are still produced by the same compiled matcher over the line
the engine already holds, still UTF-16 code units into the returned string, still computed against the
decoded-then-truncated line in that order, still found by `find_iter` over the whole stripped line and clipped
to the cut, and still crossed as line text plus a flat `Uint32Array`. Every one of those arguments is
load-bearing today. The half that is about **`capture`** has nothing left to describe: every `NetgrepHit`
carries its line and its ranges, because a streamed hit without a line is meaningless and there is no flag to
turn off.

**The "no alias" argument was right about the cost, and something else dissolved it.** *"Two booleans make four
states… and both would then be threaded into the result-type generics forever. The union has one input and
three states, all of them real."* That reasoning is sound and this record does not retract it: given a
*returned result* whose shape depends on a flag, the union is the right shape and the boolean pair is the worse
one. 0027 deleted both generics anyway, and not by finding a better encoding of the flag — by removing the
thing the flag varied. `capture: C` existed so a boolean caller need not pay for a string copy; splitting the
third state (`matches()`) into its own function pays for that structurally, and the other two states collapse
into one unconditional hit. The union's cost was bounded and real; what ended it was the answer stopping being
a returned result at all.

**Three exports become two.** *"A third export, not a changed one"* — `search_bytes_line` and
`search_bytes_line_ranges` are both deleted, and `search_block` takes their place beside `search_bytes`. The
sentence that survives is the last one: *"the membership path still allocates nothing and copies no string,
and that is a property of which function is called rather than a claim about a flag."* It survives precisely
because `matches()` still calls `search_bytes`, which is untouched. The shared `with_matcher` memo and the
single `build_searcher` still hold across both remaining exports, so binary detection and matching semantics
still cannot drift between them — pinned by `test_the_two_entry_points_share_one_searcher_configuration` and
`test_the_two_entry_points_share_one_matcher` in `packages/search/tests/search.rs`, which now say *two* where
they used to say three.

**Both consequences are still true, restated in `NetgrepHit` terms.** `ranges` can be `[]` on a real hit —
every match can fall past the `maxLineBytes` cut, and inside a line longer than 64 KB the yielded "line" is a
fragment that need not contain the match (BACKLOG **3g**). And a match on an empty line is `line: ""` with
`ranges: [{ start: 0, end: 0 }]`. The pins moved with the code: the cut case is
`a_match_past_the_cap_is_dropped` and `a_match_straddling_the_cap_is_clamped` in `mod block` of
`packages/search/tests/search.rs`, and *keeps the hit when the match itself is past the cut* in
`grep.integration.spec.ts`; the empty line is `a_match_on_an_empty_line_is_an_empty_string_with_a_range` and
*treats an EMPTY matching line as a hit, not as a miss*; the 3g fragment is the two `BACKLOG 3g` tests in
`grep.integration.spec.ts`. **The advice changes shape**, though: *"Branch on `result`, never on `line` or on
`ranges.length`"* has no `result` field to name any more. A yielded hit **is** the match — its existence is the
answer, and `line` and `ranges.length` are still not the thing to test. The edge is unchanged; only the field
that used to carry it is gone.

**The *Rejected alongside* table takes the same casualties as 0020's**, and for the same reasons, set out row
by row in [0020](0020-the-matching-line.md)'s amendment: **Line numbers** and **All matching lines** are
withdrawn, **Match counts** stands on a new reason, **File-absolute byte offsets** stands unchanged, **Context
lines** stands but is deferred with a design recorded, and **Ranking** stands untouched and for its own
reason — no term statistics, no document frequencies, no index — which was never the early-exit reason and
must not be filed with the rows above it.

**And the closing rule is amended, not deleted.** *"The way to reopen one is to show its reason wrong, not to
point at this record."* That still holds, and 0027 explicitly declines to use this record as precedent. What it
adds is a second route: line numbers and all matching lines were **not** shown wrong. Their stated reasons were
true, and 0027 chose to **pay** them — every byte read from offset 0, and a delivery shape that bounds the
result size. A row therefore leaves a refusal table either by having its reason falsified or by having its cost
knowingly taken on in a record that says which of the two it is doing. Pointing at a record remains not a
reason.
