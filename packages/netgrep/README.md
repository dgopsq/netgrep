<!-- Absolute: npm renders this README off GitHub, where a relative path resolves to nothing. -->
![new Netgrep(); — search remote files while they're downloading](https://raw.githubusercontent.com/dgopsq/netgrep/main/assets/header.png)

# @netgrep/netgrep

The main `netgrep` package. See the [main README](https://github.com/dgopsq/netgrep) for more information.

netgrep streams a URL's response through ripgrep's real regex engine and answers the moment a
matching line arrives — without waiting for the last byte, and without holding the file in memory.
No index to build, no backend to run.

It answers one question per URL — *does this pattern occur?* — as a boolean, plus the first matching
line if you pass `capture: 'line'`, or that line with each match's position within it under
`capture: 'line-ranges'`. That is the whole result: no ranking, no match counts, no line numbers, no
positions in the file. It costs a **~1.17 MB WebAssembly download** (~500 KB gzipped) once per page
load, and it has [known limitations](https://github.com/dgopsq/netgrep#known-limitations) worth
reading first.
