# Changelog

## [0.5.0](https://github.com/dgopsq/netgrep/compare/example-0.4.2...example-0.5.0) (2026-08-16)


### Features

* **netgrep:** run outside the browser (Node, Deno, Workers) ([#61](https://github.com/dgopsq/netgrep/issues/61)) ([d1df667](https://github.com/dgopsq/netgrep/commit/d1df667a064fb0d4f98d0b0dc18093893a9e78de))

## [0.4.2](https://github.com/dgopsq/netgrep/compare/example-0.4.1...example-0.4.2) (2026-08-15)


### Bug fixes

* **example:** the docs contents lists the sections, one open at a time ([#57](https://github.com/dgopsq/netgrep/issues/57)) ([6f5e17c](https://github.com/dgopsq/netgrep/commit/6f5e17c7bbecb8e9b3cc83bee761bc814099d55a))


### Performance

* **example:** preload the engine, and report the host's wait as its own figure ([#58](https://github.com/dgopsq/netgrep/issues/58)) ([344f750](https://github.com/dgopsq/netgrep/commit/344f7505c1dd1954c17951e664c6e06be347d85f))

## [0.4.1](https://github.com/dgopsq/netgrep/compare/example-0.4.0...example-0.4.1) (2026-08-08)


### Bug fixes

* **example:** one wordmark fade across the lockup, as in the artwork ([#55](https://github.com/dgopsq/netgrep/issues/55)) ([436f537](https://github.com/dgopsq/netgrep/commit/436f53730b501e16025b2a93b300484497a7497e))

## [0.4.0](https://github.com/dgopsq/netgrep/compare/example-0.3.0...example-0.4.0) (2026-08-07)


### ⚠ BREAKING CHANGES

* **netgrep:** search_bytes_line, search_bytes_line_ranges and the LineWithRanges carrier are removed from @netgrep/search. Use search_block.

### Features

* **assets:** the wordmark becomes net | grep ([#53](https://github.com/dgopsq/netgrep/issues/53)) ([4997dc3](https://github.com/dgopsq/netgrep/commit/4997dc3e1bb82b6f3156b7fc9f3a4870675b9bd2))
* **example:** the demo becomes a live grep ([#52](https://github.com/dgopsq/netgrep/issues/52)) ([88183a7](https://github.com/dgopsq/netgrep/commit/88183a75c1527cda1282ccfdf20dfcf41637d724))
* **netgrep:** grep() and matches() replace the class ([#51](https://github.com/dgopsq/netgrep/issues/51)) ([893a344](https://github.com/dgopsq/netgrep/commit/893a344ee0657caed95588675ec6c2c9674d04ef))


### Bug fixes

* **example:** render the net | grep wordmark on the page, not new Netgrep(); ([#54](https://github.com/dgopsq/netgrep/issues/54)) ([12ea3c1](https://github.com/dgopsq/netgrep/commit/12ea3c1e91d7265fc23d0fae5ba66e38a1056ebd))

## [0.3.0](https://github.com/dgopsq/netgrep/compare/example-0.2.0...example-0.3.0) (2026-08-03)


### Features

* **example:** the demo is a log dashboard over four large files ([#41](https://github.com/dgopsq/netgrep/issues/41)) ([f32a0f8](https://github.com/dgopsq/netgrep/commit/f32a0f80147a64b0a3492d6031a03eefd6c393b4))
* **netgrep:** remove the in-memory cache ([#39](https://github.com/dgopsq/netgrep/issues/39)) ([9f1a4b7](https://github.com/dgopsq/netgrep/commit/9f1a4b7bafdc1819b0ac1695dd549240bb327af7))

## [0.2.0](https://github.com/dgopsq/netgrep/compare/example-0.1.0...example-0.2.0) (2026-08-01)


### ⚠ BREAKING CHANGES

* `captureLine: true` becomes `capture: 'line'` in `NetgrepSearchConfig`. There is no behavioural change for existing callers beyond the option's name.

### Features

* capture match ranges within the matching line ([#32](https://github.com/dgopsq/netgrep/issues/32)) ([244477c](https://github.com/dgopsq/netgrep/commit/244477c4f8680460574c2e975a5c36cb05fbd74b))
* **example:** turn the demo into a documentation site ([#35](https://github.com/dgopsq/netgrep/issues/35)) ([e5a500b](https://github.com/dgopsq/netgrep/commit/e5a500bec41cb70b6da6b283acd3077074104339))

## 0.1.0 (2026-07-31)


### ⚠ BREAKING CHANGES

* @netgrep/search 0.2.0 requires `await init()` before `search_bytes`. @netgrep/netgrep's public API is unchanged — it absorbs the instantiation internally.

### Features

* **example:** move the demo to netgrep.diegopasquali.com, and make it findable ([#25](https://github.com/dgopsq/netgrep/issues/25)) ([2d48ecd](https://github.com/dgopsq/netgrep/commit/2d48ecd9795def23fe288fa766cf64c2238b3927))
* **netgrep:** return the first matching line, on request ([#29](https://github.com/dgopsq/netgrep/issues/29)) ([f60b6db](https://github.com/dgopsq/netgrep/commit/f60b6dba4acb1bd0d69862cf29434f7ea85f6903))
* web target, CI modernization, and the example dev-server fix ([#7](https://github.com/dgopsq/netgrep/issues/7)) ([bdd9f97](https://github.com/dgopsq/netgrep/commit/bdd9f979127fc1a602fcb39b0378d3fac734bc3d))


### Bug fixes

* **example:** make the Open Graph image look like the rest of the artwork ([#26](https://github.com/dgopsq/netgrep/issues/26)) ([703493c](https://github.com/dgopsq/netgrep/commit/703493c03b10176af7f17498c1acee78a947d4ab))
* **netgrep:** find matches that straddle a chunk boundary ([#27](https://github.com/dgopsq/netgrep/issues/27)) ([28728f3](https://github.com/dgopsq/netgrep/commit/28728f380815b312299106e69e67b61fe854b0e2))
* **netgrep:** share one download between concurrent searches of a url ([#28](https://github.com/dgopsq/netgrep/issues/28)) ([dc03352](https://github.com/dgopsq/netgrep/commit/dc033521b78a77fe148451f2f5f97d56992f06f9))
