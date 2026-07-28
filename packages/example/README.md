# Netgrep example

This is an example for a basic usage of the `@netgrep/netgrep` package using [Webpack](https://webpack.js.org/). See the [main README](https://github.com/dgopsq/netgrep) for more information.

It runs against the **local workspace source**, not a published release, so changes to `packages/netgrep` or `packages/search` show up here after a rebuild.

## Usage

From the root of this repository install the dependencies and build the WASM core — the example cannot resolve `@netgrep/search` until `packages/search/pkg/` exists:

```bash
pnpm install
pnpm build:wasm
```

and then start the dev server:

```bash
pnpm dev
```

This is a manual smoke test, not part of the automated suite.
