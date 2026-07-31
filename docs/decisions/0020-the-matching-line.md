# 0020 — Return the first matching line, on request

**Status:** Accepted. Widens the public API for the first time, and **amends [0003](0003-boolean-only-results.md)**,
whose decision — "the answer is a boolean" — no longer holds unconditionally.

Proposed in [issue #19](https://github.com/dgopsq/netgrep/issues/19).

## Context

netgrep answered a boolean per url and nothing else, by the deliberate choice recorded in
[0003](0003-boolean-only-results.md). That made it a *filter*: a page could list which files matched, but to
show a reader **why** a file matched it had to re-fetch the file and search it again in JavaScript. The demo
did exactly that — nothing, in fact, because it had no way to.

Of the three things the README concedes to an index engine — rank, snippet, locate — the snippet is the only
one netgrep can produce without inventing machinery it has no basis for. Ranking needs a scoring model.
Positions need offset bookkeeping that fights early exit. **The matching line is already in hand:**
`Sink::matched` is handed `SinkMatch::bytes()` on every hit, and it was being discarded.

Two things had to be true before this was worth doing, and only one of them was true when the issue was filed.

**The first is that the line has to be a line.** Before [0018](0018-line-oriented-tail-buffer.md) each `fetch`
chunk was searched in isolation, so a first occurrence straddling a chunk seam was missed entirely and the
"first" line returned would silently be the file's *second* match — varying run to run with how the network
split the response. A snippet built on that would have been non-deterministic and wrong in a way a boolean
never exposed. `splitAtLastLine` fixed it as a side effect of fixing backlog 3a: the engine is now handed
**whole lines in file order**, so the first match it reports is the file's first matching line, whatever the
chunking. That is what makes this feature honest, and it is why this record could not have been written two
commits earlier.

**The second is that a cache hit and a cold fetch must agree.** [0018](0018-line-oriented-tail-buffer.md) also
made the cache write only from a drained stream, so an entry is the whole file in one buffer. The warm path
and the cold path now return the same line rather than two different ones.

The issue's own strongest argument against was that this is the top of a slope, not that it is expensive. That
is answered below rather than dismissed.

## Decision

**Opt-in, per search.** `NetgrepSearchConfig.captureLine` defaults to `false`.

```ts
const res = await ng.search(url, pattern, undefined, { captureLine: true });
if (res.result) console.log(res.line); // `string`, no null check
```

Four choices make up the decision.

**A second WASM export, not a changed one.** `search_bytes`'s signature and behaviour are untouched;
`search_bytes_line(chunk, pattern, max_line_bytes) -> Option<String>` sits beside it. Both share the
compiled-matcher memo of [0016](0016-compiled-matcher-memo.md) through a generic `with_matcher`, and one
`build_searcher` — so binary detection cannot drift between them, which would be a difference in `result`
rather than merely in what comes back alongside it. (`try_search_bytes`'s *internals* did move onto
`with_matcher`; what callers see did not change.) `@netgrep/search` therefore stays
backwards-compatible — a minor bump, not a major — and, more importantly, the `captureLine: false` path is
*structurally* the same call it has always been. "Zero cost when off" is a property of the code rather than a
claim about it.

**The flag's effect is in the type.** `L` is threaded from `NetgrepSearchConfig<L>` into `NetgrepResult<T, L>`,
constrained to `boolean` so TypeScript keeps the literal:

- `L = false` — the type is byte-for-byte what it was, with **no `line` key at all**. Reading one is a compile
  error, not a silent `undefined`, and `tsc` is the proof that existing consumers are unaffected.
- `L = true` — `result` becomes a discriminant: `{ result: true; line: string } | { result: false; line: null }`.
  Narrowing on `result` yields a `string`, because a line exists exactly when there was a match.
- `maxLineBytes` is typed `never` unless `captureLine` is `true`, so setting a cap that would govern nothing is
  a compile error.

Note the two opposite uses of `never` are deliberate. For the *config* the concern is writing, and `never`
blocks it perfectly. For the *result* the concern is reading, and `never` would collapse to `undefined` and
read silently — so there the key is genuinely absent instead.

**`line`, not `snippet`.** It is one line of the file, and the name says so. `snippet` is the vocabulary of the
index engines netgrep explicitly is not, and it would leave room to quietly change the shape later, which is
the opposite of what this record is for.

**Bounded in Rust, before the copy.** The line is trimmed of its terminator (`\n`, and a preceding `\r`),
truncated to `maxLineBytes` on a UTF-8 character boundary, then decoded with `String::from_utf8_lossy` — in
that order, so the cap applies to content and the lossy pass runs over at most `maxLineBytes`. Default 4096.
Truncating on the JavaScript side would have paid the megabyte copy it exists to avoid.

`maxLineBytes` is clamped at **both** ends before it crosses. The lower bound is obvious; the upper one is
not, and matters more: the number reaches the engine through `ToUint32`, which wraps rather than saturates, so
`Infinity`, `NaN` and 2³² all arrive as **0** — and a cap of 0 returns an empty string for every match, which
is precisely how a match on an empty line is reported. Left unbounded, the obvious way to spell "no cap"
produced the one result this API cannot afford to be ambiguous about. `Infinity` is therefore read as the
largest cap the engine can hold, and `NaN` as no request at all.

## Consequences

- **An empty string is a match.** A pattern matching an empty line returns `""`, which is falsy. `undefined` is
  the only no-match signal at the boundary, and `runEngine` in `Netgrep.ts` tests for it explicitly. Pinned
  from both sides: `test_a_match_on_an_empty_line_is_an_empty_string` in `packages/search/tests/search.rs` and
  "treats an EMPTY line as a match, not a miss" in `Netgrep.spec.ts`. This is the sharpest edge in the feature.
- **Lossy decoding.** A latin-1 file, or any invalid UTF-8, yields `U+FFFD` in the line. Acceptable for a
  snippet, and a new class of wrong output that a boolean API could not produce. Documented in the README.
- **Inside a line longer than 64 KB the "line" is a fragment** — the third consequence of backlog 3g, recorded
  there. Past `MAX_TAIL_BYTES` the retained tail degrades to a byte window, so the block handed to the engine
  starts mid-line and the returned string begins at an arbitrary byte. `result` is still correct. Returning
  `null` in that case was considered and rejected: it would break the `result: true ⇒ line: string` invariant
  for every consumer, to describe a case only minified input reaches. Pinned in `Netgrep.integration.spec.ts`.
- **The published demo now shows the line**, and `CAVEATS[0]` changed from "One boolean per file" to "No
  ranking, no positions". Required by [AGENTS.md §2.3](../../AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it):
  the page's only value is that it is accurate, and it was asserting the absence of a feature that now exists.
- **The `.wasm` grew 15,769 bytes** (1,148,922 → 1,164,691, +1.4%), so the `StatsBar` figure moved from 1.15 MB
  to 1.16 MB. Backlog 14's table is updated.
- **The project's stated posture changed.** AGENTS.md §1 said "Do not add features"; it now says feature
  proposals go through an issue and a decision record. That rule is what made this proposal get argued
  properly, and the replacement keeps the friction while dropping the contradiction of shipping a feature
  under a document forbidding them.

## Rejected alongside

Recorded now, while the reasoning is fresh, because the issue's own best objection was the slope rather than
the cost. Each of these is a reasonable follow-up ask, and each is more expensive than the line:

| Ask | Why not |
|---|---|
| **Line numbers** | Requires counting terminators across every chunk, including ones early exit never reads. The count would be of *searched* lines, not file lines, so it would be wrong in exactly the cases anyone would check. |
| **Byte offsets** | Offsets are relative to the block handed to the engine, not the file. Making them absolute means tracking a running position through the tail buffer and the windowed case, which is bookkeeping that fights [0002](0002-search-while-downloading.md). |
| **Match counts** | Directly contradicts the short-circuit: counting means scanning the whole file, which is early exit deleted. Measured at 16.4ms → 1.3ms in [0016](0016-compiled-matcher-memo.md), in the wrong direction. |
| **All matching lines** | Same objection, plus an unbounded result size per file. |
| **Context lines (`-A`/`-B`)** | Needs lines the block may not contain — the preceding line can be in the previous chunk, already discarded. |
| **Highlight ranges** | Offsets by another name, and the caller can re-run the pattern against a line it now has. |
| **Ranking** | netgrep has no term statistics, no document frequencies and no index. There is nothing to rank *with*. The honest answer stays "use an index". |

The line is the last of these that is cheap. If a future ask needs any of the above, the answer is very
probably Pagefind.
