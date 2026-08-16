# Getting started

netgrep is grep over HTTP, in a browser or on a server. Point it at a URL and a pattern: it streams the
response through [ripgrep](https://github.com/BurntSushi/ripgrep)'s real regex engine — the
`grep-matcher`, `grep-regex` and `grep-searcher` crates, unmodified from crates.io — and answers the
moment a matching line arrives, without waiting for the last byte and without holding the file in
memory. There is no index to build and no backend to run.

## Requirements

- **A runtime with streaming `fetch`.** netgrep needs `fetch` with a readable response body stream:
  a browser, **Node 18.19+ or 20.6+**, Deno, or Cloudflare Workers. Each boots the WebAssembly the way
  its own runtime allows, and the API is identical in all four. The Node floor is set by the boot module
  rather than by `fetch`: it resolves the binary through a synchronous, unflagged `import.meta.resolve`,
  which arrived in 18.19.0 and 20.6.0. [Runtimes](08-runtimes.md) has a runnable example for each, and the
  flags and limits that come with them.
- **ESM.** The package is ESM only. There is no CommonJS `require` entry point.
- **A ~1.17 MB WebAssembly download** (~500 KB gzipped), fetched once per page load in a browser. Most
  of it is the regex engine's Unicode tables. It is the main cost of the approach. On a server or in a
  Worker it is compiled once when the code loads, not per request.
- **A URL the runtime is allowed to fetch — in a browser, a CORS rule.** A cross-origin file needs
  `Access-Control-Allow-Origin` from its host, or the fetch fails before the search starts, as an opaque
  network error rather than as anything netgrep can explain. That header is necessary and not
  sufficient: nothing is set on the request by default — no `Authorization`, no API key, and no cookies,
  since a cross-origin request sends none by default — so a file behind a login comes back as the host's
  401 or sign-in page however permissive its CORS policy. `grep` and `matches` take per-call `fetch`
  options, so a file behind a header, an API key or a cookie is reachable — but the host still has to
  answer the cross-origin request. Cross-origin permission is a **browser** rule, so off the browser it
  does not apply — a server, a Worker or a Deno process can read a URL whose host sends no
  `Access-Control-Allow-Origin` at all. Whatever authorization the host itself requires still applies,
  and still has to be passed in.

## Install

```bash
# Using pnpm
pnpm add @netgrep/netgrep

# Using npm
npm install @netgrep/netgrep
```

No bundler configuration is required. netgrep loads its WebAssembly through a standard
`new URL('…', import.meta.url)` reference, which Vite, webpack 5, Rollup, esbuild, Parcel, Bun and — for a
Worker — wrangler all understand. The binary is loaded as soon as the module is imported — fetched in the
background in a browser, read from disk in Node, inlined into the script by a Workers bundler — and the
first search waits for it.

## Your first search

```ts
import { matches } from '@netgrep/netgrep';

const found = await matches(
  'https://netgrep.diegopasquali.com/logs/apache.txt',
  'jk2_init',
);
```

For a plain does-it-occur question that boolean is the whole answer.
[Searching](02-searching.md) covers `grep`, which gives you every matching line instead, and
[The matching line](03-the-matching-line.md) covers what a hit contains.

The URL is absolute, and in three of the four runtimes it has to be: only a browser has a document for a
relative path to be resolved against. That and the rest of what differs per runtime — Node's version floor,
Deno's two permission flags, the Worker bundle's size — are in [Runtimes](08-runtimes.md).

## When to use it

netgrep applies to a file you can address but cannot preprocess: a document someone else publishes,
an artefact or build log served openly or behind a signed URL, a file in a bucket you do not own. An
index would answer faster, but building one means owning the build, and it cannot answer about a file
that appeared a minute ago. A file behind a login is reachable only if you can hand netgrep the
credential yourself, through the [request options](02-searching.md#request-options) — it sends none
of its own.

It also fits files you *do* own, when standing up a search backend is not worth it: a real-time
search over a blog's raw post files needs nothing deployed. One runs on
[my blog](https://diegopasquali.com/search), and its [source](https://github.com/dgopsq/writings) is
public.

Use an index instead when there are many files, when they are large, when you can preprocess them,
or when results have to be ranked. netgrep reads the whole file unless you stop it early, and it
reports matches in the order they occur rather than ordering them by relevance;
[Pagefind](https://pagefind.app/), [Lunr](https://lunrjs.com/) and
[FlexSearch](https://github.com/nextapps-de/flexsearch) do those things well. The
[limitations](07-limitations.md) page is specific about where the line falls.
