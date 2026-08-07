<!-- Absolute: npm renders this README off GitHub, where a relative path resolves to nothing. -->
![The netgrep wordmark: new Netgrep(); set in monospace, fading from white into teal on a dark gradient](https://raw.githubusercontent.com/dgopsq/netgrep/main/assets/header.png)

# @netgrep/search

The WASM porting of [ripgrep](https://github.com/BurntSushi/ripgrep). See the [main README](https://github.com/dgopsq/netgrep) for more information.

This is the low-level core of [`@netgrep/netgrep`](https://www.npmjs.com/package/@netgrep/netgrep), which is
probably the package you want — it adds the streaming that makes the engine useful over HTTP. Used directly, this one exposes two functions, and its default export is an `init` you must await
before calling either of them:

```ts
search_bytes(chunk: Uint8Array, pattern: string): boolean
search_block(chunk: Uint8Array, pattern: string, maxLineBytes: number): BlockHits
```

`search_bytes` answers membership and allocates nothing. `search_block` returns **every** matching line in
the chunk, as two flat values rather than an array of objects — `text`, the matching lines joined by `\n`,
and `table`, a `Uint32Array` holding `[hitCount, linesInBlock]` and then `[lineNumber, nRanges, start, end,
…]` per hit. Two values cross the WASM boundary per call however many lines matched, which is what keeps
memory flat on a file with hundreds of thousands of hits; the caller walks the table and builds each result
at the moment it needs it.

Each line is terminator stripped, truncated to `maxLineBytes` on a UTF-8 character boundary and decoded
lossily. Its `start`/`end` offsets are **UTF-16 code units of that returned line**, so `line.slice(start,
end)` works without conversion. `nRanges` counts *pairs*, and can be zero: a line can match past the
truncation cut, in which case the hit is still reported with nothing to highlight. Count hits rather than
testing `text` for truthiness — a pattern matching an empty line is a real hit whose line is `""`, and a
zero-hit block also has empty `text`.

Both **throw** if the pattern is not valid regex, so a stray `(` from a search box is an ordinary catchable
error. Both share one compiled matcher and one searcher configuration, so their matching semantics cannot
differ: anything `search_bytes` calls a match, `search_block` returns the line for.

On its own this package is a **~1.17 MB WebAssembly binary** (~500 KB gzipped) and nothing else. Its
[known limitations](https://github.com/dgopsq/netgrep#known-limitations) are worth reading first — netgrep
does not detect binary files, results inside a line longer than 64 KB are approximate, and on input using bare
CR line endings `^`/`$` anchor to a boundary the returned line does not.
