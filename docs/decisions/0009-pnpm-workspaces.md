# 0009 — pnpm workspaces, and a hand-written manifest for the WASM package

**Status:** Accepted (2026-07-28). Replaces the Nx setup in [0007](0007-nx-cargo-hybrid-monorepo.md).

## Context

The repository had **no workspace linking of any kind**. There was no `workspaces` field, three separate
`yarn.lock` files (root, `packages/netgrep`, `packages/example`), and the root `package.json` declared a
dependency on **its own published package**, `@netgrep/netgrep@^0.1.3`.

The consequence was the most expensive trap in the project: editing `lib.rs` or `Netgrep.ts` changed nothing
that any other package could see. The example demo resolved `@netgrep/netgrep` from `node_modules` — a 2022
release from npm. "Rebuild the WASM and check the example" was a way to observe four-year-old behaviour and
draw a confident, wrong conclusion. It was documented at length as a hazard rather than fixed.

## Decision

**pnpm workspaces**, globbing `packages/*`. One `pnpm-lock.yaml` replaces three `yarn.lock` files. Root no
longer depends on its own releases. `packages/netgrep` depends on `@netgrep/search` as `workspace:*`, and the
example on `@netgrep/netgrep` as `workspace:*`.

pnpm specifically, over npm or yarn: its strictness about phantom dependencies is a direct fit for the class
of rot this repository accumulated. It proved that immediately — the first install surfaced that the example
imports `lodash/debounce` while only the *root* manifest ever declared lodash.

### The wrinkle: the publishable unit is a build output

`@netgrep/search` is not `packages/search/` — it is `packages/search/pkg/`, a **gitignored directory that
wasm-pack generates**. No workspace glob can point at something that does not exist on a fresh clone.

So `packages/search/package.json` is **hand-written**, owns the npm name, and includes the generated
directory via `"files": ["pkg"]`. wasm-pack's own `pkg/package.json` is demoted to an internal artefact.

The alternative — globbing `packages/search/pkg` directly — was rejected because it forces anyone touching
only TypeScript to install a Rust toolchain before `pnpm install` will even resolve.

## Consequences

**Good:**
- Local edits reach every package. The example is now an honest smoke test.
- An integration test against the real engine became possible at all.
- `post_build.js` copies the version from `Cargo.toml` into the wrapper manifest, so the Rust and npm
  versions cannot drift.
- One lockfile, ~7,300 fewer lines.

**Costs:**
- Two manifests exist for one package. The generated one is not the published one, which surprises people;
  it is called out in `AGENTS.md` §5 and in `post_build.js`.
- `pnpm build:wasm` must run before `pnpm typecheck`, `pnpm build` or the integration tests, because
  `@netgrep/search` resolves to a directory that does not exist until then. `pnpm install` and the unit tests
  work without it.
- pnpm requires an explicit decision on dependency postinstall scripts (`allowBuilds` in
  `pnpm-workspace.yaml`); a clean `--frozen-lockfile` install fails without it.

**A trap this introduced, and how it is guarded.** wasm-pack writes a `.gitignore` containing `*` into
`pkg/`. npm honours a package-internal `.gitignore` when there is no `.npmignore`, so `"files": ["pkg"]`
silently resolved to *nothing* and produced a tarball with no WASM in it. Harmless under the old layout
(which packed from *inside* `pkg/`), fatal under this one. `post_build.js` now deletes that file, and
`scripts/verify-pack.mjs` fails CI if the tarball is ever missing its contents again.
