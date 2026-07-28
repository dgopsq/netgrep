# 0005 — ESM only; a bundler is required

**Status:** Accepted, **amended (2026-07-28)** — see *Amendment* at the end. ESM-only still holds, but the
bundler requirement recorded below is gone; consumers now need no bundler configuration at all.

## Context

`wasm-pack`'s default (`--target bundler`) output imports the `.wasm` file directly, which only a bundler that
understands WebAssembly modules can resolve. Webpack 5 does this behind the `asyncWebAssembly` experiment flag.

## Decision

Ship ESM only.

- `packages/netgrep/package.json` sets `"type": "module"`.
- `scripts/post_build.js` injects `"type": "module"` into the generated `@netgrep/search` manifest, because
  `wasm-pack` does not emit it and without it Node and some bundlers misread the generated ESM.
- Consumers must enable `experiments.asyncWebAssembly` in their webpack config.

The README carried this as an explicit warning: *"At the moment this library is exported only as an ESM, thus
a bundler like Webpack is required to use it."* (Removed in 2026 — see the amendment.)

## Consequences

- **This is the library's main adoption barrier.** No `<script>` tag usage, no CommonJS `require`, no
  Node.js consumption, and a required config change in the host application.
- Relative imports in the TypeScript sources must carry the **`.js` extension** even though the files are
  `.ts` (`import { NetgrepResult } from './data/NetgrepResult.js'`). This is mandatory for the emitted ESM to
  resolve. New files must follow it.
- The jest setup has to work around ESM: `useESM: true` in the `ts-jest` globals, plus a babel config at the
  root.
- Dual ESM+CJS output would mean two build passes and a conditional `exports` map — plausible maintenance
  work, but it does not remove the bundler requirement, which comes from the WASM import, not the module
  format.


---

## Amendment (2026-07-28) — the bundler target was the real problem

This record treated `experiments.asyncWebAssembly` as an acceptable cost of ESM-only distribution. It was not
an ESM problem at all; it was a **wasm-pack target** problem, and it was worse than documented.

`@netgrep/search` shipped wasm-pack's `bundler` target, whose entry does:

```js
import * as wasm from './index_bg.wasm';
```

That is an ESM-integration wasm import. webpack supports it behind the experiment flag. **Vite does not, and
failed silently** — the build emitted the `.wasm`, kept the marshalling glue, never assigned the exports
object, and every search returned `false` with no error anywhere. Because `searchBatch` folds per-URL failures
into `{result: false}`, a completely broken build was indistinguishable from "no matches".

So the published package did not work for most of the current ecosystem, and failed by giving **wrong answers
rather than crashing** — the worst possible mode for an API that is a single boolean.

**Fixed in 0.2.0 by shipping the `web` target instead**, which loads the binary through a standard
`new URL('index_bg.wasm', import.meta.url)`. Verified in real headless Chrome against Vite (no plugins, no
config file), webpack 5 (**no config at all** — the experiment flag is gone), and a fresh app installed from
the actual published tarballs.

The cost is that `init()` must be awaited before `search_bytes`, which is breaking for direct consumers of
`@netgrep/search`. `Netgrep` absorbs it — it starts `init()` once at module load and awaits it at the top of
`search` — so `@netgrep/netgrep`'s public API is unchanged. Upgrading consumers only need to *delete* their
webpack experiment flag.

ESM-only remains correct. Consumers now need **less** configuration than this record anticipated, not more.
