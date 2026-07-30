

![new Netgrep(); — search remote files while they're downloading](assets/header.png)

# netgrep

**[Try it →](https://netgrep.diegopasquali.com/)** — a live demo searching 56 Sherlock Holmes stories, showing
each file resolve as it downloads. Its known limitations are listed on the page, not hidden.

> [!IMPORTANT]
> **This is an experiment, not a recommendation.** Netgrep is almost certainly not the best way to add search
> to your site. A prebuilt index — [Pagefind](https://pagefind.app/), [Lunr](https://lunrjs.com/),
> [FlexSearch](https://github.com/nextapps-de/flexsearch), or a hosted service — will usually be smaller,
> faster and far more capable: it can rank results, show snippets and tell you *where* a term appears, none
> of which netgrep does.
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
- **A ~1.15 MB WebAssembly download** (~480 KB gzipped), fetched once per page load. Most of it is the regex
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
  plain 64 KB window, so a match **longer** than the window is lost, and `^` can match at a window edge where no
  line actually begins. Newline-free input is also answered more slowly, because nothing can be searched until
  the ceiling fills or the download ends.
- **A file containing a NUL byte reports no match** for the block of lines containing it, even when the match
  came earlier. Binary detection abandons what it is given rather than stopping at the NUL.
- **`$` does not match on CRLF files.** The line terminator is `\n`, so on Windows-authored text the `\r`
  sits between your text and the anchor: `needle$` misses what `needle` finds. `^` is unaffected.
- **Two concurrent searches of the same URL are not de-duplicated.** Both download the file. The answers are
  correct and the cache entry is correct; the second request is simply wasted. Await one search of a URL before
  starting another if that matters.

### Fixed, and not yet in a published release

Both of these are fixed on `main` and **still present in the version on npm**. The list above describes the
code; this one describes the gap until the next release.

- **A match spanning two network chunks used to be missed** — a silent `false` that depended on how the network
  chunked the response. See the first limitation above for what remains of it.
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
