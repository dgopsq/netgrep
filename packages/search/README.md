<!-- Absolute: npm renders this README off GitHub, where a relative path resolves to nothing. -->
![new Netgrep(); — search remote files while they're downloading](https://raw.githubusercontent.com/dgopsq/netgrep/main/assets/header.png)

# @netgrep/search

The WASM porting of [ripgrep](https://github.com/BurntSushi/ripgrep). See the [main README](https://github.com/dgopsq/netgrep) for more information.

This is the low-level core of [`@netgrep/netgrep`](https://www.npmjs.com/package/@netgrep/netgrep), which is
probably the package you want — it adds the streaming, batching and caching that make the engine useful over
HTTP. Used directly, this one exposes two functions, and its default export is an `init` you must await before
calling either:

```ts
search_bytes(chunk: Uint8Array, pattern: string): boolean
search_bytes_line(chunk: Uint8Array, pattern: string, maxLineBytes: number): string | undefined
```

The second returns the **first matching line** — terminator stripped, truncated to `maxLineBytes` on a UTF-8
character boundary, decoded lossily — or `undefined` for no match. Note `undefined` is the only no-match
signal: a pattern matching an empty line returns `""`, which is falsy. Both **throw** if the pattern is not
valid regex, so a stray `(` from a search box is an ordinary catchable error.

> [!IMPORTANT]
> **This is an experiment, not a recommendation.** netgrep is almost certainly not the best way to add
> search to your site — a prebuilt index ([Pagefind](https://pagefind.app/), [Lunr](https://lunrjs.com/),
> [FlexSearch](https://github.com/nextapps-de/flexsearch), or a hosted service) will usually be smaller,
> faster and far more capable. What this explores is a narrower question: what happens if you compile
> ripgrep's actual search engine to WebAssembly and run it over HTTP against files *while they are still
> downloading*.
>
> Note also that this package is a **~1.16 MB WebAssembly binary** (~500 KB gzipped) and has
> [known limitations](https://github.com/dgopsq/netgrep#known-limitations) — a single NUL byte discards the
> chunk being searched, and `$` does not match on CRLF input.
