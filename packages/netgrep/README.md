<!-- Absolute: npm renders this README off GitHub, where a relative path resolves to nothing. -->
![new Netgrep(); — search remote files while they're downloading](https://raw.githubusercontent.com/dgopsq/netgrep/main/assets/header.png)

# @netgrep/netgrep

The main `netgrep` package. See the [main README](https://github.com/dgopsq/netgrep) for more information.

> [!IMPORTANT]
> **This is an experiment, not a recommendation.** netgrep is almost certainly not the best way to add
> search to your site — a prebuilt index ([Pagefind](https://pagefind.app/), [Lunr](https://lunrjs.com/),
> [FlexSearch](https://github.com/nextapps-de/flexsearch), or a hosted service) will usually be smaller,
> faster and far more capable. What this explores is a narrower question: what happens if you compile
> ripgrep's actual search engine to WebAssembly and run it over HTTP against files *while they are still
> downloading*.
>
> It answers one question per URL — *does this pattern occur?* — as a boolean, and will hand you the first
> matching line if you pass `capture: 'line'`, or that line plus each match's position within it with
> `capture: 'line-ranges'`. That is the whole result: no ranking, no line numbers, no positions in the file.
> It has [known limitations](https://github.com/dgopsq/netgrep#known-limitations) that are worth reading
> before you build on it.
