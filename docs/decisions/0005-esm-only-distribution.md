# 0005 — ESM only; a bundler is required

**Status:** Accepted. Acknowledged in the README as a limitation.

## Context

`wasm-pack`'s default (`--target bundler`) output imports the `.wasm` file directly, which only a bundler that
understands WebAssembly modules can resolve. Webpack 5 does this behind the `asyncWebAssembly` experiment flag.

## Decision

Ship ESM only.

- `packages/netgrep/package.json` sets `"type": "module"`.
- `scripts/post_build.js` injects `"type": "module"` into the generated `@netgrep/search` manifest, because
  `wasm-pack` does not emit it and without it Node and some bundlers misread the generated ESM.
- Consumers must enable `experiments.asyncWebAssembly` in their webpack config.

The README carries this as an explicit warning: *"At the moment this library is exported only as an ESM, thus
a bundler like Webpack is required to use it."*

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
