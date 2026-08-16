<!-- Absolute: npm renders this README off GitHub, where a relative path resolves to nothing. -->
![The netgrep wordmark: net | grep set in monospace, fading from white into teal on a dark gradient](https://raw.githubusercontent.com/dgopsq/netgrep/main/assets/header.png)

# @netgrep/netgrep

The main `netgrep` package. See the [main README](https://github.com/dgopsq/netgrep) for more information.

netgrep streams a URL's response through [ripgrep](https://github.com/BurntSushi/ripgrep)'s real
regex engine and answers the moment a matching line arrives — without waiting for the last byte, and
without holding the file in memory. No index to build, no backend to run.

It runs anywhere `fetch` gives you a readable response body stream — a browser, Node, Deno or Cloudflare
Workers — and it is ESM only. In a browser the file has to be one the page is allowed to fetch — a
cross-origin URL needs `Access-Control-Allow-Origin`, which is a browser rule and does not apply off the
browser, and netgrep puts nothing on the request beyond the per-call `fetch`
options you hand it, so anything behind a login needs its credential passed in explicitly.

`matches` answers whether a pattern occurs; `grep` yields every matching line, with each match's
position within it and the line's number in the file. That is the whole result: no ranking, no match
counts, no context lines, no byte offsets into the file. It costs a **~1.17 MB WebAssembly download**
(~500 KB gzipped) once per page load — or, off the browser, one compile when the code loads — and it has
[known limitations](https://github.com/dgopsq/netgrep#known-limitations) worth reading first.
