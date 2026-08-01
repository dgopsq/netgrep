# The matching line, and where the matches are in it

Pass `capture` and the result also carries the first matching line of the file. In `'line-ranges'` mode it
carries every match's position within that line too. A search without `capture` costs exactly what it always
did: each mode has its own engine entry point, so the boolean path allocates nothing and copies no string out
of WebAssembly.

```ts
const output = await NG.search(url, 'Sherlock', undefined, { capture: 'line-ranges' });

if (output.result) {
  console.log(output.line); // `string` — no null check needed

  // output.ranges: [{ start, end }] — UTF-16 offsets into output.line,
  // so this is the matched text:
  output.ranges.map((r) => output.line.slice(r.start, r.end));
}
```

The option's effect is in the type, so TypeScript tells you which shape you have:

| Called with | Type of the result |
|---|---|
| no config, or no `capture` | `{ url, pattern, result: boolean, metadata? }`. There is no `line` key and no `ranges` key, and reading either is a compile error |
| `{ capture: 'line' }` | `result` becomes a discriminant: `{ result: true, line: string }` or `{ result: false, line: null }` |
| `{ capture: 'line-ranges' }` | the same, plus ranges: `{ result: true, line: string, ranges: { start, end }[] }` or `{ result: false, line: null, ranges: null }` |

The ranges come from the engine's own matcher run over the line, not from re-running your pattern in
JavaScript, which could not reproduce smart case or the Rust regex syntax and would highlight differently than
netgrep matched. Two limits:

- **Only the first matching line.** They cover every match in that line, and the search still stops there.
- **`ranges` can be empty on a match.** If every match falls past `maxLineBytes` the returned line cannot show
  any of them, and `ranges` is `[]` while `result` stays `true`. Do not branch on `ranges.length`.

`maxLineBytes` caps the line, defaulting to 4096. The truncation happens inside WebAssembly, before the copy,
so pointing netgrep at minified JavaScript costs you a snippet rather than a megabyte per file. The cut lands
on a UTF-8 character boundary, and on a range boundary too: a range past the cut is dropped, one straddling it
is clamped. Setting the cap without `capture` is a compile error.

The string itself:

- **The line terminator is stripped**: a trailing `\n`, and a `\r` immediately before it. You can render the
  line directly.
- **An empty line is a match.** `line` can be `""` when the pattern matches a blank line, and `""` is falsy.
  Branch on `result`, never on `line`.
- **Decoding is lossy.** Bytes that are not valid UTF-8 (a latin-1 file, say) become `U+FFFD`. The match
  itself is unaffected; the engine works on bytes.

Line numbers, file-wide byte offsets, match counts, every matching line, context lines and ranking are all
absent by choice. [Decision 0020](../decisions/0020-the-matching-line.md) and
[decision 0022](../decisions/0022-capture-ranges.md) say why for each. If you need them, you need an index.
