![new Netgrep(); — search remote files while they're downloading](assets/header.png)

# netgrep

**netgrep is grep over HTTP, running in the browser.** Point it at a URL and a pattern: it streams
the response through [ripgrep](https://github.com/BurntSushi/ripgrep)'s real regex engine —
`[[:alpha:]]`, `(?x)`, smart case, arbitrary
mid-word substrings — and answers the moment a matching line arrives, without waiting for the last
byte and without holding the file in memory. There is no index to build and no backend to run, so it
works on files you don't control and can't preprocess, and the query never leaves the tab.

**[Try it →](https://netgrep.diegopasquali.com/)** · **[Documentation →](https://netgrep.diegopasquali.com/docs/)**

## Requirements

- **A browser.** netgrep needs `fetch` with a readable response body stream. There is no Node.js
  support.
- **ESM.** The package is ESM only. There is no CommonJS `require` entry point.
- **A ~1.17 MB WebAssembly download** (~500 KB gzipped), fetched once per page load. Most of it is
  the regex engine's Unicode tables, and it is the main cost of the approach.
- **A URL the browser will let you read.** A cross-origin file needs `Access-Control-Allow-Origin`
  from the host serving it; without that header the fetch fails before the search starts. Files you
  do not control often do not send it.

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

A result is a boolean per URL, plus — if you ask for it — the first matching line and each match's
position within it. That is the whole answer: no ranking, no match counts, no line numbers. Batches,
cancellation, caching and the regex dialect are all in the
[documentation](https://netgrep.diegopasquali.com/docs/).

## Known limitations

These are documented rather than fixed. Each is pinned by a test, so none of them can change
unnoticed, and each is explained in full in the
[documentation](https://netgrep.diegopasquali.com/docs/#limitations).

<!-- BEGIN GENERATED CAVEATS -->
- **[Inside a line longer than 64 KB, results are approximate](https://netgrep.diegopasquali.com/docs/#long-lines)** — Past a 64 KB line with no terminator, a longer match is lost and `^` can match at a window edge.
- **[A file containing a NUL byte reports no match](https://netgrep.diegopasquali.com/docs/#nul-byte)** — A NUL byte discards the block of lines containing it, even when the match came earlier.
- **[`$` does not match on CRLF files](https://netgrep.diegopasquali.com/docs/#crlf-dollar)** — On Windows-authored text the `\r` sits between your text and the anchor, so `needle$` misses what `needle` finds.
<!-- END GENERATED CAVEATS -->

Fixes land on `main` before they reach npm; [`CHANGELOG.md`](https://github.com/dgopsq/netgrep/blob/main/packages/netgrep/CHANGELOG.md)
shows which of them have been released.

## Documentation

| | |
|---|---|
| [netgrep.diegopasquali.com/docs](https://netgrep.diegopasquali.com/docs/) | How to use it, in full |
| [`docs/guide/`](https://github.com/dgopsq/netgrep/tree/main/docs/guide) | The same, as markdown in this repository |
| [`docs/ARCHITECTURE.md`](https://github.com/dgopsq/netgrep/blob/main/docs/ARCHITECTURE.md) | How it works inside |
| [`docs/decisions/`](https://github.com/dgopsq/netgrep/tree/main/docs/decisions) | Why it is shaped this way |
| [`CONTRIBUTING.md`](https://github.com/dgopsq/netgrep/blob/main/CONTRIBUTING.md) | Building it yourself, and opening a pull request |
| [`AGENTS.md`](https://github.com/dgopsq/netgrep/blob/main/AGENTS.md) | Working in this repository |

## License

netgrep is under the [MIT license](https://github.com/dgopsq/netgrep/blob/main/LICENSE).
