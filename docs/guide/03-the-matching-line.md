# The matching line

Every hit `grep` yields is the same shape:

```ts
type NetgrepHit = {
  line: string;                            // terminator stripped
  ranges: Array<{ start: number; end: number }>; // UTF-16 offsets into `line`
  lineNumber: number;                      // 1-based, counted from the file
};
```

There is nothing to opt into. A streamed hit with no line would be meaningless, so the line, its ranges
and its number are unconditional — `matches` is what you call when you want none of them.

## `line`

The whole line, not the matched fragment, with its terminator stripped — `\n` and a `\r\n` alike.

A match on an empty line is a hit with `line: ""`. Branch on whether a hit was yielded at all, never on
`line` being truthy or on `ranges.length`.

Bytes that are not valid UTF-8 are decoded lossily rather than rejected, so a line from a mixed-encoding
log arrives with replacement characters rather than throwing.

## `ranges`

Where the pattern matched *within* `line`, in order, as UTF-16 code-unit offsets — JavaScript's own string
indexing, so `line.slice(start, end)` is the matched text with no conversion. They are not byte offsets,
and they are relative to the returned line, never to the file.

They come from the engine rather than from a second pass in JavaScript, which is the only way they can be
right: a JS re-match cannot reproduce smart case or the regex crate's syntax, so it would disagree with
the verdict it was meant to explain.

`ranges` can be empty on a real hit — see the cap below.

## `lineNumber`

The line's 1-based position in the file, not in the network chunk it arrived in, and it counts
non-matching lines too. Exact until a single line outgrows 64 KB, past which it gains a line each time the
window slides ([Limitations](07-limitations.md#long-lines)).

## `maxLineBytes`

Lines are truncated to 4096 bytes by default. Pass `maxLineBytes` to change it:

```ts
grep(url, pattern, { maxLineBytes: 512 });
```

The cut happens inside WebAssembly, before the copy, so a minified bundle or a one-line data dump cannot
move megabytes per file into JavaScript. It is taken on a UTF-8 character boundary, and it applies to the
line's content — the terminator is stripped first.

The pattern is matched against the **full** line and then the ranges are cut to fit: one straddling the
cut is clamped, and one starting past it is dropped. So a hit whose every match sits past the cut arrives
with `ranges: []`. It is still a hit — the line matched — and the string simply cannot show a position it
does not hold. Matching the truncated slice instead would let `$` match at the cut and report a match the
real line does not contain.

## What is absent, and by choice

No byte offsets into the file, no match counts, no ranking. Each is refused for its own stated reason
rather than by blanket policy — see [decision 0020](../decisions/0020-the-matching-line.md),
[0022](../decisions/0022-capture-ranges.md) and
[0027](../decisions/0027-streaming-matching-lines.md), which restates all three while withdrawing the two
refusals either side of them: every matching line, and its number, are now unconditional.

Surrounding context lines are the one thing deferred rather than refused. 0027 records the design and
nothing here forecloses it.
