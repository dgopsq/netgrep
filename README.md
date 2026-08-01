![new Netgrep(); — search remote files while they're downloading](assets/header.png)

# netgrep

Search remote text files from the browser **while they are still downloading**. netgrep is
[ripgrep](https://github.com/BurntSushi/ripgrep)'s search engine compiled to WebAssembly and pointed
at plain static files — no index to build, no backend to run.

**[Try it →](https://netgrep.diegopasquali.com/)** · **[Documentation →](https://netgrep.diegopasquali.com/docs/)**

This is an experiment, not a recommendation. A prebuilt index — [Pagefind](https://pagefind.app/),
[Lunr](https://lunrjs.com/), [FlexSearch](https://github.com/nextapps-de/flexsearch), or a hosted
service — will usually be smaller, faster and far more capable: it can rank results and count
matches, neither of which netgrep does. What this project explores is narrower: whether ripgrep's
actual engine, run over HTTP against files as they arrive, is useful. It is, on a small corpus. It is
a demonstration of that idea rather than infrastructure.

## Requirements

- **A browser.** netgrep needs `fetch` with a readable response body stream. There is no Node.js
  support.
- **ESM.** The package is distributed as ESM only — there is no CommonJS `require` entry point.
- **A ~1.17 MB WebAssembly download** (~500 KB gzipped), fetched once per page load. Most of it is
  the regex engine's Unicode tables, and it is the main cost of the approach.

## Install

```bash
pnpm add @netgrep/netgrep
```

No bundler configuration is required. The WebAssembly is fetched as soon as the module is imported,
and the first search waits for it.

```ts
import { Netgrep } from '@netgrep/netgrep';

const NG = new Netgrep();

const output = await NG.search('/posts/hello.md', 'sherlock', undefined, {
  capture: 'line',
});

if (output.result) {
  console.log(output.line); // the first matching line
}
```

Batches, match positions within the line, cancellation, caching and the regex dialect are all in the
**[documentation](https://netgrep.diegopasquali.com/docs/)**.

## Known limitations

netgrep is experimental, and these are real and documented rather than fixed. Each is pinned by a
test, and explained in full in the [documentation](https://netgrep.diegopasquali.com/docs/#limitations).

<!-- BEGIN GENERATED CAVEATS -->
- **[Inside a line longer than 64 KB, results are approximate](https://netgrep.diegopasquali.com/docs/#long-lines)** — Past a 64 KB line with no terminator, a longer match is lost and `^` can match at a window edge.
- **[A file containing a NUL byte reports no match](https://netgrep.diegopasquali.com/docs/#nul-byte)** — A NUL byte discards the block of lines containing it, even when the match came earlier.
- **[`$` does not match on CRLF files](https://netgrep.diegopasquali.com/docs/#crlf-dollar)** — On Windows-authored text the `\r` sits between your text and the anchor, so `needle$` misses what `needle` finds.
- **[Concurrent searches of one URL are only de-duplicated when the cache is on](https://netgrep.diegopasquali.com/docs/#concurrent-dedup)** — With the cache off, two concurrent searches of one URL both download it — correct answers, wasted request.
<!-- END GENERATED CAVEATS -->

Fixes land on `main` before they reach npm — [`CHANGELOG.md`](https://github.com/dgopsq/netgrep/blob/main/packages/netgrep/CHANGELOG.md)
is the gap between the two.

## Documentation

| | |
|---|---|
| [netgrep.diegopasquali.com/docs](https://netgrep.diegopasquali.com/docs/) | How to use it — the full reference |
| [`docs/guide/`](https://github.com/dgopsq/netgrep/tree/main/docs/guide) | The same, as markdown in this repository |
| [`docs/ARCHITECTURE.md`](https://github.com/dgopsq/netgrep/blob/main/docs/ARCHITECTURE.md) | How it works inside |
| [`docs/decisions/`](https://github.com/dgopsq/netgrep/tree/main/docs/decisions) | Why it is shaped this way |
| [`CONTRIBUTING.md`](https://github.com/dgopsq/netgrep/blob/main/CONTRIBUTING.md) | Building it yourself, and opening a pull request |
| [`AGENTS.md`](https://github.com/dgopsq/netgrep/blob/main/AGENTS.md) | Working in this repository |

## License

netgrep is under the [MIT license](https://github.com/dgopsq/netgrep/blob/main/LICENSE).
