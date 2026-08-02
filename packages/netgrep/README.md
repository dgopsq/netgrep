<!-- Absolute: npm renders this README off GitHub, where a relative path resolves to nothing. -->
![The netgrep wordmark: new Netgrep(); set in monospace, fading from white into teal on a dark gradient](https://raw.githubusercontent.com/dgopsq/netgrep/main/assets/header.png)

# @netgrep/netgrep

The main `netgrep` package. See the [main README](https://github.com/dgopsq/netgrep) for more information.

netgrep streams a URL's response through [ripgrep](https://github.com/BurntSushi/ripgrep)'s real
regex engine and answers the moment a matching line arrives — without waiting for the last byte, and
without holding the file in memory. No index to build, no backend to run.

It runs in a browser and nowhere else: it needs `fetch` with a streaming response body, it is ESM
only, and a cross-origin URL has to send `Access-Control-Allow-Origin` or the request fails before
the search starts. That header is the first gate a remote file has to pass, not the only one: netgrep
builds its own request and puts nothing on it — no `Authorization` header, no API key, and no
cookies, since a cross-origin request sends none by default. A file behind a login is fetched
anonymously and so cannot be searched, however permissive its CORS policy is.

It answers one question per URL — *does this pattern occur?* — as a boolean, plus the first matching
line if you pass `capture: 'line'`, or that line with each match's position within it under
`capture: 'line-ranges'`. That is the whole result: no ranking, no match counts, no line numbers, no
positions in the file. It costs a **~1.17 MB WebAssembly download** (~500 KB gzipped) once per page
load, and it has [known limitations](https://github.com/dgopsq/netgrep#known-limitations) worth
reading first.
