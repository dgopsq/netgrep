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
a log or an artefact on a CI platform you are a customer of, a published corpus, a file a support
agent can open but not download. An index cannot help there — building one means owning the build,
and it cannot find a file that appeared thirty seconds ago. netgrep searches the file itself, as it
arrives.

The same property makes it work for a small static corpus you *do* own: a real-time search over a
blog's raw post files needs nothing new deployed. One runs on
[my blog](https://diegopasquali.com/search), and its [source](https://github.com/dgopsq/writings) is
public.

What netgrep is not is a search *system*. It does not rank, and it reads every byte of a file it
does not match — so against a large corpus, or one you can preprocess, a prebuilt index wins on both
counts. The [limitations](07-limitations.md) page is specific about where that line falls.
