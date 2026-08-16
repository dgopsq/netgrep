![The netgrep wordmark: net | grep set in monospace, fading from white into teal on a dark gradient](assets/header.png)

# netgrep

**netgrep is grep over HTTP, running in the browser.** Point it at a URL and a pattern: it streams
the response through [ripgrep](https://github.com/BurntSushi/ripgrep)'s real regex engine —
`[[:alpha:]]`, `(?x)`, smart case, arbitrary
mid-word substrings — and answers the moment a matching line arrives, without waiting for the last
byte and without holding the file in memory. There is no index to build and no backend to run, so it
works on files you don't control and can't preprocess, and the query never leaves the tab.

**[Try it →](https://www.netgrep.dev/)** · **[Documentation →](https://www.netgrep.dev/docs/)**

## Requirements

- **A browser.** netgrep needs `fetch` with a readable response body stream. There is no Node.js
  support.
- **ESM.** The package is ESM only. There is no CommonJS `require` entry point.
- **A ~1.17 MB WebAssembly download** (~500 KB gzipped), fetched once per page load. Most of it is
  the regex engine's Unicode tables, and it is the main cost of the approach.
- **A URL the browser is allowed to fetch.** A cross-origin file needs `Access-Control-Allow-Origin`
  from its host, and nothing is set on the request by default — no headers, no API key, and no cookies
  cross-origin. `grep` and `matches` take per-call `fetch` options, so a file behind a header, an API key
  or a cookie is reachable — but the host still has to answer the cross-origin request.

## Install

```bash
pnpm add @netgrep/netgrep
```

No bundler configuration is required. The WebAssembly is fetched as soon as the module is imported,
and the first search waits for it.

```ts
import { grep, matches } from '@netgrep/netgrep';

// Does this file mention it? Stops reading at the first hit.
const found = await matches('https://example.com/app.log', 'ECONNREFUSED');

// Which lines? Yielded as they are found, while the file is still arriving.
for await (const hit of grep('https://example.com/app.log', 'ECONNREFUSED')) {
  console.log(hit.lineNumber, hit.line);
}
```

`matches` answers whether a pattern occurs; `grep` yields every matching line, with each match's
position within it and the line's number in the file. That is the whole answer: no ranking, no match
counts, no context lines, no byte offsets into the file. Cancellation, request options, caching and the regex dialect are all in the
[documentation](https://www.netgrep.dev/docs/).

## Known limitations

These are documented rather than fixed. Each is pinned by a test, so none of them can change
unnoticed, and each is explained in full in the
[documentation](https://www.netgrep.dev/docs/#limitations).

<!-- BEGIN GENERATED CAVEATS -->
- **[Inside a line longer than 64 KB, results are approximate](https://www.netgrep.dev/docs/#long-lines)** — Past a 64 KB line with no terminator, a longer match is lost and `^` can match at a window edge.
- **[`^`/`$` also anchor to a bare `\r`, not just `\r\n`](https://www.netgrep.dev/docs/#bare-cr-anchors)** — A file with old-Mac or progress-bar `\r` line endings gets extra anchor matches the returned line doesn't agree with.
<!-- END GENERATED CAVEATS -->

Fixes land on `main` before they reach npm; [`CHANGELOG.md`](https://github.com/dgopsq/netgrep/blob/main/packages/netgrep/CHANGELOG.md)
shows which of them have been released.

## Documentation

| | |
|---|---|
| [www.netgrep.dev/docs](https://www.netgrep.dev/docs/) | How to use it, in full |
| [`docs/guide/`](https://github.com/dgopsq/netgrep/tree/main/docs/guide) | The same, as markdown in this repository |
| [`docs/ARCHITECTURE.md`](https://github.com/dgopsq/netgrep/blob/main/docs/ARCHITECTURE.md) | How it works inside |
| [`docs/decisions/`](https://github.com/dgopsq/netgrep/tree/main/docs/decisions) | Why it is shaped this way |
| [`CONTRIBUTING.md`](https://github.com/dgopsq/netgrep/blob/main/CONTRIBUTING.md) | Building it yourself, and opening a pull request |
| [`AGENTS.md`](https://github.com/dgopsq/netgrep/blob/main/AGENTS.md) | Working in this repository |

## License

netgrep is under the [MIT license](https://github.com/dgopsq/netgrep/blob/main/LICENSE).
