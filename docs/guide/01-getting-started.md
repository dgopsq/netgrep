# Getting started

netgrep is grep over HTTP, running in the browser. Point it at a URL and a pattern: it streams the
response through [ripgrep](https://github.com/BurntSushi/ripgrep)'s real regex engine — the
`grep-matcher`, `grep-regex` and `grep-searcher` crates, unmodified from crates.io — and answers the
moment a matching line arrives, without waiting for the last byte and without holding the file in
memory. There is no index to build and no backend to run.

## Requirements

- **A browser.** netgrep needs `fetch` with a readable response body stream. There is no Node.js
  support.
- **ESM.** The package is ESM only. There is no CommonJS `require` entry point.
- **A ~1.17 MB WebAssembly download** (~500 KB gzipped), fetched once per page load. Most of it is
  the regex engine's Unicode tables. It is the main cost of the approach.
- **A URL the browser can fetch anonymously.** A cross-origin file needs `Access-Control-Allow-Origin`
  from its host, or the fetch fails before the search starts, as an opaque network error rather than
  as anything netgrep can explain. That header is necessary and not sufficient: `Netgrep.search` sets
  nothing on the request — no `Authorization`, no API key, and no cookies, since a cross-origin request
  sends none by default — so a file behind a login comes back as the host's 401 or sign-in page however
  permissive its CORS policy. Supplying your own request options is not available on this API.

## Install

```bash
# Using pnpm
pnpm add @netgrep/netgrep

# Using npm
npm install @netgrep/netgrep
```

No bundler configuration is required. netgrep loads its WebAssembly through a standard
`new URL('…', import.meta.url)` reference, which Vite, webpack 5, Rollup, esbuild, Parcel and Bun all
understand. The WASM file is fetched in the background as soon as the module is imported, and the
first search waits for it.

## Your first search

```ts
import { Netgrep } from '@netgrep/netgrep';

const NG = new Netgrep();

const output = await NG.search('/posts/hello.md', 'sherlock');

console.log(output.result); // boolean — did the pattern occur?
```

For a plain search that boolean is the whole answer. [Searching](02-searching.md) covers metadata and
batches, and [The matching line](03-the-matching-line.md) covers getting the line itself back.

## When to use it

netgrep applies to a file you can address but cannot preprocess, and that a browser can fetch
without signing in: a document someone else publishes, an artefact or build log served openly or
behind a signed URL, a file in a bucket you do not own. An index would answer faster, but building
one means owning the build, and it cannot answer about a file that appeared a minute ago. Anything
that loads only because you are signed in is out of reach — netgrep sends no credentials.

It also fits files you *do* own, when standing up a search backend is not worth it: a real-time
search over a blog's raw post files needs nothing deployed. One runs on
[my blog](https://diegopasquali.com/search), and its [source](https://github.com/dgopsq/writings) is
public.

Use an index instead when there are many files, when they are large, when you can preprocess them,
or when results have to be ranked. netgrep reads every byte of a file that does not match, and it
answers per file rather than ordering them; [Pagefind](https://pagefind.app/), [Lunr](https://lunrjs.com/) and
[FlexSearch](https://github.com/nextapps-de/flexsearch) do those things well. The
[limitations](07-limitations.md) page is specific about where the line falls.
