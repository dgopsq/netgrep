<!-- Absolute: npm renders this README off GitHub, where a relative path resolves to nothing. -->
![The netgrep wordmark: new Netgrep(); set in monospace, fading from white into teal on a dark gradient](https://raw.githubusercontent.com/dgopsq/netgrep/main/assets/header.png)

# @netgrep/search

The WASM porting of [ripgrep](https://github.com/BurntSushi/ripgrep). See the [main README](https://github.com/dgopsq/netgrep) for more information.

This is the low-level core of [`@netgrep/netgrep`](https://www.npmjs.com/package/@netgrep/netgrep), which is
probably the package you want — it adds the streaming and batching that make the engine useful over
HTTP. Used directly, this one exposes three functions, and its default export is an `init` you must await
before calling any of them:

```ts
search_bytes(chunk: Uint8Array, pattern: string): boolean
search_bytes_line(chunk: Uint8Array, pattern: string, maxLineBytes: number): string | undefined
search_bytes_line_ranges(chunk: Uint8Array, pattern: string, maxLineBytes: number): LineWithRanges | undefined
```

The second returns the **first matching line** — terminator stripped, truncated to `maxLineBytes` on a UTF-8
character boundary, decoded lossily — or `undefined` for no match. The third returns that same line plus
`ranges`, a flat `Uint32Array` of `[start, end, …]` pairs in **UTF-16 code units of the returned line**, one
per match within it; it can be empty when every match sits past the truncation cut. Note `undefined` is the
only no-match signal: a pattern matching an empty line returns `""`, which is falsy. All three **throw** if
the pattern is not valid regex, so a stray `(` from a search box is an ordinary catchable error.

Each is a separate entry point so a caller pays only for what it asks for, and all three share one compiled
matcher and one searcher, so their matching semantics cannot differ.

On its own this package is a **~1.17 MB WebAssembly binary** (~500 KB gzipped) and nothing else. Its
[known limitations](https://github.com/dgopsq/netgrep#known-limitations) are worth reading first — netgrep
does not detect binary files, results inside a line longer than 64 KB are approximate, and on input using bare
CR line endings `^`/`$` anchor to a boundary the returned line does not.
