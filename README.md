

![new Netgrep(); — search remote files while they're downloading](assets/header.png)

# netgrep

**[Try it →](https://netgrep.diegopasquali.com/)** — a live demo searching 56 Sherlock Holmes stories, showing
each file resolve as it downloads. Its known limitations are listed on the page, not hidden.

> [!IMPORTANT]
> **This is an experiment, not a recommendation.** Netgrep is almost certainly not the best way to add search
> to your site. A prebuilt index — [Pagefind](https://pagefind.app/), [Lunr](https://lunrjs.com/),
> [FlexSearch](https://github.com/nextapps-de/flexsearch), or a hosted service — will usually be smaller,
> faster and far more capable: it can rank results and tell you *where* a term appears, neither of which
> netgrep does. Netgrep can hand you the first matching line, and that is the end of what it knows.
>
> What this project explores is a narrower question: what happens if you take ripgrep's actual search engine,
> compile it to WebAssembly, and run it over HTTP against files *while they are still downloading*? The
> answer turns out to be "it works, and it is genuinely fast on a small corpus" — but it is a demonstration
> of that idea, not infrastructure. Read the [known limitations](#known-limitations) before building on it.

Netgrep is an **experimental** porting of [ripgrep](https://github.com/BurntSushi/ripgrep) on WASM using the HTTP protocol. The scope of this project is to explore an alternative to index-based search engines for applications with a small files-based database. It is built on the `grep-matcher`, `grep-regex` and `grep-searcher` crates published from the `ripgrep` repository, used unmodified from crates.io. 

At the moment Netgrep is just going to tell whether a pattern is present on a remote file leveraging the `ripgrep` core search engine. This happens **while the file is being downloaded** in order to maximize the performance. 

> [!NOTE]
> Searching for posts on a blog created through a Static Site Generator is an interesting use-case for this experiment. Netgrep could easily be used to create a real-time search engine from the raw post files. A live example for this behavior can be found on [my blog](https://diegopasquali.com/search) (you can take a look at the [source code](https://github.com/dgopsq/writings)).

## Requirements

- **A browser.** Netgrep needs `fetch` with a readable response body stream. There is no Node.js support.
- **ESM.** The package is distributed as ESM only — there is no CommonJS `require` entry point.
- **A ~1.17 MB WebAssembly download** (~500 KB gzipped), fetched once per page load. Most of it is the regex
  engine's Unicode tables. This is the main cost of the approach, and it is worth weighing against your
  corpus size before adopting it.

Since `0.2.0` no bundler *configuration* is required.

## Usage

> [!TIP]
> A complete example is available [in the `example` package](https://github.com/dgopsq/netgrep/tree/main/packages/example), and running at [netgrep.diegopasquali.com](https://netgrep.diegopasquali.com/).

First of all install the module:

```bash
# Using pnpm
pnpm add @netgrep/netgrep

# Using npm
npm install @netgrep/netgrep
```

No bundler configuration is required. `netgrep` loads its WebAssembly through a standard
`new URL('…', import.meta.url)` reference, which Vite, webpack 5, Rollup, esbuild, Parcel and Bun all
understand out of the box.

> [!TIP]
> **Upgrading from 0.1.x?** Delete the `experiments.asyncWebAssembly` flag from your webpack config — it is
> no longer needed. Nothing else changes; the API is identical.

The WASM file is fetched in the background as soon as the module is imported, and the first search waits for
it automatically:

```ts
import { Netgrep } from '@netgrep/netgrep';

// Create a Netgrep instance, here it's
// possible to pass an initial configuration.
const NG = new Netgrep();

// Execute a Netgrep search on the url using 
// the given pattern.
NG.search("url", "pattern")
  .then((output) => {
    console.log('The pattern has matched', output.result)
  });

// It's possible to pass custom metadata during
// the search. These will be returned back in the result
// for convenience.
NG.search("url", "pattern", { title: 'A blog post' })
  .then((output) => {
    console.log('The pattern has matched', output.result)
    console.log('Metadata', output.metadata)
  });

// There is a convenient method to do batched searches
// to multiple urls. Using `searchBatch` the resulting `Promise`
// will resolve only after the completion of all the searches.
NG.searchBatch([
  { url: 'url1' },
  { url: 'url2' },
  { url: 'url3' }
], "pattern")
  .then((outputs) => {
    outputs.forEach((output) => {
      console.log(`The pattern has matched for ${output.url}`, output.result)
    });
  });

// If you want to avoid waiting for the completion of
// all the searches, the method `searchBatchWithCallback` will
// execute a callback every time a search completes.
NG.searchBatchWithCallback([
  { url: 'url1' },
  { url: 'url2' },
  { url: 'url3' }
], "pattern", (output) => {
  console.log(`The pattern has matched for ${output.url}`, output.result)
});
```

## What you get back

A single search resolves to a result carrying the answer and whatever metadata you passed in:

```ts
{
  url: string;
  pattern: string;
  result: boolean;      // the whole answer: did the pattern occur?
  metadata?: T;         // returned untouched, for correlating results back to your own objects
}
```

### The matching line, and where the matches are in it

Pass `capture` and the result also carries the **first matching line** of the file — and, in `'line-ranges'`
mode, **every match's position within that line**. Nothing else changes, and a search without `capture` costs
exactly what it always did: each mode has its own engine entry point, so the boolean path allocates nothing
and copies no string out of WebAssembly.

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
| no config, or no `capture` | `{ url, pattern, result: boolean, metadata? }` — **there is no `line` key and no `ranges` key**, and reading either is a compile error |
| `{ capture: 'line' }` | `result` becomes a discriminant: `{ result: true, line: string }` or `{ result: false, line: null }` |
| `{ capture: 'line-ranges' }` | the same, plus ranges: `{ result: true, line: string, ranges: { start, end }[] }` or `{ result: false, line: null, ranges: null }` |

The ranges come from the engine's own matcher run over the line, not from re-running your pattern in
JavaScript — which could not reproduce smart case or the Rust regex syntax, and would highlight differently
than netgrep matched. Two things to know about them:

- **They are all the matches in the first matching line**, and only that line. The search still stops there.
- **`ranges` can be empty on a match.** If every match falls past `maxLineBytes` the returned line cannot show
  any of them, and `ranges` is `[]` while `result` stays `true`. Do not branch on `ranges.length`.

`maxLineBytes` caps the line, defaulting to **4096**. The truncation happens inside WebAssembly, before the
copy, so pointing netgrep at minified JavaScript costs you a snippet rather than a megabyte per file. The cut
is taken on a UTF-8 character boundary — and on a range boundary too: a range past the cut is dropped, one
straddling it is clamped. Setting the cap without `capture` is a compile error.

> [!IMPORTANT]
> **Renamed:** `captureLine: true` is now `capture: 'line'`. The boolean is gone, with no alias — a union was
> the only way to add a third mode without carrying two flags forever. Behaviour is otherwise unchanged.

Three things to know about the string:

- **The line terminator is stripped** — a trailing `\n`, and a `\r` immediately before it — so you can render
  it directly.
- **An empty line is a match.** `line` can be `""` when the pattern matches a blank line, and `""` is falsy.
  Branch on `result`, never on `line`.
- **Decoding is lossy.** Bytes that are not valid UTF-8 — a latin-1 file, say — become `U+FFFD`. The match
  itself is unaffected; the engine works on bytes.

Line numbers, file-wide byte offsets, match counts, every matching line, context lines and ranking are all
deliberately absent, and each was considered and refused —
[decision 0020](docs/decisions/0020-the-matching-line.md) and
[decision 0022](docs/decisions/0022-capture-ranges.md) say why for each. If you need them, you need an index.

The batch methods add an `error` field, and this is the part worth reading twice:

```ts
{ /* …as above… */ error: string | null }
```

> [!WARNING]
> **`searchBatch` and `searchBatchWithCallback` never reject.** A failed request — network error, 404, CORS —
> is captured as `{ result: false, error: "…" }`, which is indistinguishable from a genuine "no match" unless
> you check `error`. Single `search` calls behave the opposite way: they *reject*, and have no `error` field.

```ts
const outputs = await NG.searchBatch(inputs, pattern);

const matched = outputs.filter((o) => o.error === null && o.result);
const failed = outputs.filter((o) => o.error !== null);
```

## Patterns

A pattern is anything the Rust [`regex`](https://docs.rs/regex/) crate understands, which is what ripgrep
itself uses. Note that **smart case is hardcoded on**:

| Pattern | Behaviour |
|---|---|
| `sherlock` — all lowercase | case-**in**sensitive, matches `Sherlock` |
| `Sherlock` — contains an uppercase character | case-**sensitive**, does not match `sherlock` |

This is not configurable. Lowercase your pattern to search case-insensitively.

An invalid pattern — a stray `(`, or a literal newline from a pasted two-line string — is an ordinary
failure: `search` rejects, and the batch methods report it as `{ result: false, error: "…" }` like any other
error, carrying the regex crate's own diagnostic. Nothing needs escaping in advance, and one bad keystroke in
a search box does not affect the searches after it.

## Cancelling a search

Every search method takes an optional config with an `AbortSignal`, which is threaded into the underlying
`fetch`. This is the natural fit for a search-as-you-type box:

```ts
let controller: AbortController | undefined;

function onInput(pattern: string) {
  controller?.abort();           // cancel the previous keystroke's searches
  controller = new AbortController();

  NG.searchBatch(inputs, pattern, { signal: controller.signal })
    .then(render);
}
```

Aborted searches surface as an `error` on batch results, so filter them out as shown above.

## Caching

Netgrep keeps downloaded bytes in memory, keyed by URL, so repeat searches over the same corpus cost no
network at all. **It is enabled by default**, and it has no eviction, size cap or TTL — bytes are retained
for the lifetime of the `Netgrep` instance.

```ts
const NG = new Netgrep({ enableMemoryCache: false });
```

Disable it if you are searching a large or unbounded set of URLs, or scope the growth by discarding the
instance. See the limitation below before relying on it.

## Known limitations

Netgrep is experimental, and the following are real and **documented rather than fixed**. They are pinned by
tests so they cannot change unnoticed; the full analysis is in
[`docs/ARCHITECTURE.md`](https://github.com/dgopsq/netgrep/blob/main/docs/ARCHITECTURE.md#known-limitations--correctness-caveats).

- **Inside a line longer than 64 KB, results are approximate.** Netgrep holds back the incomplete last *line*
  of each chunk and prepends it to the next, which is exact — a match can never cross a newline — so ordinary
  text is unaffected no matter how the network splits the response. The exception is a line with no terminator
  in 64 KB, such as minified JavaScript or a one-line data dump: past that ceiling the retained bytes become a
  plain 64 KB window, so a match **longer** than the window is lost, `^` can match at a window edge where no
  line actually begins, and a line captured with `capture` is a mid-line fragment rather than a line — which
  can also leave `ranges` empty, since the fragment need not contain the match. `result` stays correct in that
  last case. Newline-free input is also answered more slowly, because nothing can
  be searched until the ceiling fills or the download ends.
- **A file containing a NUL byte reports no match** for the block of lines containing it, even when the match
  came earlier. Binary detection abandons what it is given rather than stopping at the NUL.
- **`$` does not match on CRLF files.** The line terminator is `\n`, so on Windows-authored text the `\r`
  sits between your text and the anchor: `needle$` misses what `needle` finds. `^` is unaffected.
- **Concurrent searches of one URL are only de-duplicated when the cache is on.** With
  `enableMemoryCache: true` the second caller waits for the first and is answered from the entry it writes.
  With the cache off there is no entry to hand over, so both download the file — the answers are still correct,
  the second request is simply wasted. Two residuals even with the cache on: a first caller that matches early
  resolves without reading to the end, so it writes no entry and its waiter fetches after all; and a failed
  download is not inherited, so the waiter retries with its own signal.

### Fixed, and not yet in a published release

Both of these are fixed on `main` and **still present in the version on npm**. The list above describes the
code; this one describes the gap until the next release.

- **A match spanning two network chunks used to be missed** — a silent `false` that depended on how the network
  chunked the response. See the first limitation above for what remains of it.
- **Concurrent searches of one URL both downloaded it**, and both appended what they read to the same cache
  entry — so the entry held the file twice, joined with no separator, forming a line the file never contained.
  A per-URL registry of in-flight downloads now makes the second caller wait for the first. See the limitation
  above for the case that remains.
- **The matching line was not available at all.** `capture` is new; the version on npm returns a boolean and
  nothing else — no line, and no match positions within it.
- **The cache could answer a later search wrongly.** A search resolves the moment it finds a match and stops
  downloading, which used to leave the cache holding only the beginning of the file with nothing marking it
  incomplete. An entry is now written **only once the whole file has been read**, so a search that resolves
  early caches nothing and the next one re-fetches. `enableMemoryCache: false` is no longer a workaround for
  anything.

  Worth knowing: this means the cache only fills on a search that reads to the end — a miss, or a match on the
  final line. A URL that matches early is re-fetched every time. That is the trade for never answering from a
  prefix, and it is why repeat *hits* cost network while repeat *misses* do not.

## Documentation

| | |
|---|---|
| [`docs/ARCHITECTURE.md`](https://github.com/dgopsq/netgrep/blob/main/docs/ARCHITECTURE.md) | How it works, and the limitations in full |
| [`docs/decisions/`](https://github.com/dgopsq/netgrep/tree/main/docs/decisions) | Why it is shaped this way |
| [`CONTRIBUTING.md`](https://github.com/dgopsq/netgrep/blob/main/CONTRIBUTING.md) | Building it yourself, and opening a pull request |
| [`AGENTS.md`](https://github.com/dgopsq/netgrep/blob/main/AGENTS.md) | Working in this repository |

## License

Netgrep is under the [MIT license](https://github.com/dgopsq/netgrep/blob/main/LICENSE).
