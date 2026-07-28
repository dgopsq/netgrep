# 0004 — Ship two npm packages, not one

**Status:** Accepted, **amended (2026-07-28)** — see *Amendment* at the end. Two of the costs recorded below
no longer apply, and the description of what gets published is out of date.

## Context

The project has two artefacts with completely different build toolchains: a Rust crate compiled by `wasm-pack`
to a WASM binary plus generated JS bindings, and a hand-written TypeScript library compiled by `tsc`. They
could be published as one package or two.

## Decision

Publish both:

- **`@netgrep/search`** — the `wasm-pack` output of `packages/search`. The generated `pkg/package.json` is
  what gets published, post-processed by `scripts/post_build.js`.
- **`@netgrep/netgrep`** — the `tsc` output of `packages/netgrep`, declaring `@netgrep/search` as a runtime
  dependency.

Each has its own release workflow, triggered by its own git tag prefix (`search-**`, `netgrep-**`).

## Consequences

- `wasm-pack` owns the manifest of the WASM package end to end. Merging the two would mean fighting it or
  hand-assembling the artefact.
- The WASM core is consumable on its own by anyone wanting `search_bytes` without netgrep's streaming layer.
- **Two versions must be kept in step by hand.** `packages/netgrep/package.json` declares
  `"@netgrep/search": "^0.1.5"`, so releasing a core change is a two-step dance: publish `@netgrep/search`,
  bump the dependency range, publish `@netgrep/netgrep`. Nothing enforces this and nothing checks it.
- Consumers install one package and transparently get two.
- Combined with the absence of workspace linking, this is the root cause of the disconnected dev loop
  documented in [`../../AGENTS.md` §2](../../AGENTS.md#2--read-this-before-you-edit-anything):
  `packages/netgrep` resolves `@netgrep/search` from the registry, never from the sibling directory.


---

## Amendment (2026-07-28)

The split stands, but two of its costs are gone.

**Version drift is now structural, not manual.** `packages/netgrep` depends on `@netgrep/search` as
`workspace:*`, and `scripts/post_build.js` copies the version out of `Cargo.toml` into the npm manifest on
every build. The two cannot disagree. `pnpm verify:pack` asserts it, and also that no `workspace:` range
survives packing.

**The packages are linked locally.** They used to resolve to this repository's own *published* releases, so
local edits reached neither the wrapper nor the example. pnpm workspaces fixed that; see
[0009](0009-pnpm-workspaces.md).

What remains true is the release ordering: `@netgrep/search` must be published **before** `@netgrep/netgrep`,
because pnpm rewrites `workspace:*` into a real version range at pack time.

One wrinkle this record did not anticipate: the publishable unit for `@netgrep/search` is
`packages/search/pkg/`, a **gitignored build output**, which no workspace glob can point at. The package is
therefore a hand-written `packages/search/package.json` wrapping `pkg/` via `"files"`.
