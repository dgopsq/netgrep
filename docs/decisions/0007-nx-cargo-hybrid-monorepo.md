# 0007 — Nx orchestrating both JS and Cargo

**Status: SUPERSEDED (2026-07-28).** Nx was removed; see *Outcome* at the end.

## Context

The repo holds a Rust crate, a TypeScript library and a webpack demo. Contributors need one place to run
lint/test/build without remembering which toolchain owns which package.

## Decision

Use Nx (14.5.4) as the single task runner across both ecosystems, with a Cargo workspace nested inside it.

- `workspace.json` registers all three packages; `nx.json` sets `workspaceLayout` so both apps and libs live
  under `packages/`.
- Each package's `project.json` declares its own targets. The Rust package shells out via `nx:run-commands`
  for build/publish/test (`wasm-pack …`) and uses the `@nxrs/cargo:clippy` executor for lint.
- Root `Cargo.toml` declares a Cargo workspace with `packages/search` as its only member.

Result: `nx run-many --target=lint` and `--target=test` cover both languages, which is exactly what CI runs.

## Consequences

- Uniform commands, and Nx caches `build`/`lint`/`test`/`e2e` across both ecosystems.
- Two lockfiles and two dependency graphs coexist; Nx knows about neither Cargo's nor npm's resolution.
- **`@nxrs/cargo` is a small third-party plugin** (0.3.3) and installs with an unmet peer dependency on
  `@nrwl/devkit`. It is the least-supported piece of the toolchain and a likely obstacle to any Nx upgrade.
- The Nx version predates the `@nrwl/*` → `@nx/*` package rename, so upgrading means a scope migration across
  every dev dependency, not just a version bump.
- `nx.json` sets `"defaultProject": "example"` — a bare `nx build` targets the demo, not a shipped package.
- Nx does **not** link the packages to each other. Orchestration is not workspace linking; see
  [`../../AGENTS.md` §2](../../AGENTS.md#2--read-this-before-you-edit-anything).


---

## Outcome (2026-07-28)

**Nx was removed rather than upgraded**, along with `@nxrs/cargo`, and replaced by pnpm workspaces plus a
handful of npm scripts.

It was nine majors and a package-scope rename behind (`@nrwl/*` → `@nx/*`), and earning none of it: CI only
ever ran `run-many`, never `nx affected`, so the dependency graph and cache did nothing across three packages
and ~450 lines of source. What it actually wrapped was a `tsc` call, an eslint call, a jest call, a clippy
call and two passthroughs to `wasm-pack`.

Removing it deleted nine packages and, with them, the bulk of the repository's dependency-vulnerability
count. `@nxrs/cargo` — third-party, last released May 2024, installed with an unmet peer dependency — went
with it.

The Rust/JS split this record describes is now expressed directly: `packages/search/package.json` has
`build`/`test`/`lint` scripts that shell out to `wasm-pack` and `cargo`, and pnpm runs them.
