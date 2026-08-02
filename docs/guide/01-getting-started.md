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
- **A URL the browser will let you read.** A cross-origin file needs `Access-Control-Allow-Origin`
  from the host serving it; without that header the fetch fails before the search starts, and the
  failure arrives as an opaque network error rather than as anything netgrep can explain. This is
  the first gate a remote file has to pass, so check it first — but it is not the only one.
- **A file that is readable without signing in.** netgrep builds its own request and sets nothing on
  it: no `Authorization` header, no API key, and no cookies, since a cross-origin request sends none
  by default. Anything behind a login is fetched as an anonymous stranger and comes back as the
  host's 401, 403 or sign-in page, so a file you can only reach while authenticated cannot be
  searched — a host can send `Access-Control-Allow-Origin: *` and still refuse an anonymous reader.
  Letting a caller supply its own request options is a real ask, and it is deferred rather than
  refused.

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

## What this is for

The case netgrep is built for is being handed a URL with no shell on the machine that holds the file:
a published corpus on someone else's host, a build log or an artefact whose URL opens in a browser
tab, a file a support agent can read but not download. An index cannot help there — building one
means owning the build, and it cannot find a file that appeared thirty seconds ago. netgrep searches
the file itself, as it arrives.

The niche is a **person** rather than a corpus size, but the file still has to be one an anonymous
request can fetch. An artefact behind your CI provider's login, or a log that only loads because a
session cookie rides along, is out of reach today — netgrep sends neither, so the request comes back
unauthenticated. The same resources published under a signed or otherwise unguessable URL, or copied
to a bucket that serves them openly, behave like any other file.

The same property makes it work for a small static corpus you *do* own: a real-time search over a
blog's raw post files needs nothing new deployed. One runs on
[my blog](https://diegopasquali.com/search), and its [source](https://github.com/dgopsq/writings) is
public.

What netgrep is not is a search *system*. It does not rank, and it reads every byte of a file it
does not match — so against a large corpus, or one you can preprocess, a prebuilt index wins on both
counts. The [limitations](07-limitations.md) page is specific about where that line falls.
