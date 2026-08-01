# Changelog

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
