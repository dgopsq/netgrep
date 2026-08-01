# Getting started

netgrep searches remote text files from the browser while they are still downloading. It is
[ripgrep](https://github.com/BurntSushi/ripgrep)'s search engine — the `grep-matcher`, `grep-regex`
and `grep-searcher` crates, unmodified from crates.io — compiled to WebAssembly and pointed at plain
static files. There is no index to build and no backend to run.

## Requirements

- **A browser.** netgrep needs `fetch` with a readable response body stream. There is no Node.js
  support.
- **ESM.** The package is distributed as ESM only — there is no CommonJS `require` entry point.
- **A ~1.17 MB WebAssembly download** (~500 KB gzipped), fetched once per page load. Most of it is
  the regex engine's Unicode tables. This is the main cost of the approach, and it is worth weighing
  against your corpus size before adopting it.

## Install

```bash
# Using pnpm
pnpm add @netgrep/netgrep

# Using npm
npm install @netgrep/netgrep
```

No bundler configuration is required. netgrep loads its WebAssembly through a standard
`new URL('…', import.meta.url)` reference, which Vite, webpack 5, Rollup, esbuild, Parcel and Bun all
understand out of the box. The WASM file is fetched in the background as soon as the module is
imported, and the first search waits for it automatically.

> [!TIP]
> **Upgrading from 0.1.x?** Delete the `experiments.asyncWebAssembly` flag from your webpack config —
> it is no longer needed.

## Your first search

```ts
import { Netgrep } from '@netgrep/netgrep';

const NG = new Netgrep();

const output = await NG.search('/posts/hello.md', 'sherlock');

console.log(output.result); // boolean — did the pattern occur?
```

That is the whole answer for a plain search: a boolean. [Searching](02-searching.md) covers metadata
and batches, and [The matching line](03-the-matching-line.md) covers getting the line itself back.

## What this is for

Searching posts on a blog built by a static site generator is the use case this was built around:
the raw post files are already served, so a real-time search over them needs nothing new deployed. A
live example runs on [my blog](https://diegopasquali.com/search) — the
[source](https://github.com/dgopsq/writings) is public.

> [!IMPORTANT]
> **This is an experiment, not a recommendation.** A prebuilt index — [Pagefind](https://pagefind.app/),
> [Lunr](https://lunrjs.com/), [FlexSearch](https://github.com/nextapps-de/flexsearch), or a hosted
> service — will usually be smaller, faster and far more capable. Read the
> [limitations](07-limitations.md) before building on this.
