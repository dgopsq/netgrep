---
name: wasm-release
description: Build, verify and prepare a release of the netgrep packages (@netgrep/search WASM core and/or @netgrep/netgrep TypeScript wrapper). Use when asked to build the WASM package, cut or prepare a release, bump versions, or understand the publish pipeline. Covers the wasm-pack → post_build → git-tag → npm flow and the exact toolchain pins required.
---

# Releasing netgrep

Two independently published packages, each released by pushing a git tag. This skill covers building,
verifying and **preparing** a release.

> **You may never publish.** Version bumps, `git tag`, `git push` and any `publish` command are human-only
> actions (see [`AGENTS.md` §6](../../../AGENTS.md#6-hard-rules)). `.claude/settings.json` denies them
> outright. Prepare the release, verify it, then hand over with the exact commands for a human to run.

---

## 0. Toolchain — get this right first

Nothing works otherwise:

`rust-toolchain.toml` pins **1.97.1** and `.node-version` pins **24.18.0**; both are read automatically, so
there is nothing to export beyond having the tools on `PATH`.

```bash
corepack enable pnpm
```

Install the toolchain if missing:
`rustup toolchain install 1.97.1 --target wasm32-unknown-unknown --component clippy`

---

## 1. Which package changed?

| Changed files | Release |
|---|---|
| `packages/search/**` | `@netgrep/search` — then usually `@netgrep/netgrep` too (see step 4) |
| `packages/netgrep/**` | `@netgrep/netgrep` only |
| `packages/example/**` | Nothing — not published |

---

## 2. Verify before anything else

```bash
pnpm install
pnpm build:wasm        # must run first: pkg/index.d.ts is what the TS package compiles against
pnpm build:wasm-node   # needed by the integration tests
pnpm lint              # Biome + clippy
pnpm typecheck
pnpm build
pnpm test              # 24 tests
pnpm test:wasm         # 2 tests
```

`pnpm test:wasm` fails on a fresh machine — `wasm-pack` fetches the latest ChromeDriver, which cannot drive
an older installed Chrome (`invalid session id`, driver killed with signal 9). It also **overrides**
`CHROMEDRIVER`, so exporting it and re-running `wasm-pack` changes nothing; invoke the harness directly. See
[`docs/BACKLOG.md`](../../../docs/BACKLOG.md) item 2 for the exact commands.

Do **not** try to verify via the example app — it runs against published npm packages, not local source.

---

## 3. Build outputs

**`@netgrep/search`** — `pnpm build:wasm` runs `wasm-pack` then `scripts/post_build.js`, which marks `pkg/`
as ESM and copies the version out of `Cargo.toml`. Do not skip the second step.

→ `packages/search/pkg/`: `index.js`, `index_bg.js`, `index_bg.wasm` (~1.12 MB), `index.d.ts`,
`package.json`. Gitignored.

**What gets published is `packages/search/package.json`**, a hand-written wrapper with `"files": ["pkg"]` —
not the manifest wasm-pack generates inside `pkg/`.

**`@netgrep/netgrep`** — `pnpm build` → `packages/netgrep/dist/`, also gitignored. The published manifest is
`packages/netgrep/package.json`, hand-written, with `"files": ["dist"]`.

Sanity-check before handing over:

```bash
cat packages/search/package.json     # version matches Cargo.toml?
cat packages/netgrep/package.json    # version right? @netgrep/search dependency right?
```

Note `@netgrep/netgrep` depends on `@netgrep/search` as `workspace:*`. pnpm rewrites that to a real version
range when packing, so **publish `@netgrep/search` first**.

---

## 4. Version bumps — the coupling that bites

Versions live in two places, but only one is hand-maintained:

| Package | Version source | Must also update |
|---|---|---|
| `@netgrep/search` | `packages/search/Cargo.toml` | nothing — `post_build.js` syncs the npm manifest |
| `@netgrep/netgrep` | `packages/netgrep/package.json` | — |

A change to the Rust core is still a **two-release sequence**: publish `@netgrep/search` first, then
`@netgrep/netgrep`. The version drift that used to need watching is now handled by the build.

Both publish workflows set `greater-version-only: true`, so a forgotten bump means the publish silently
no-ops rather than failing loudly.

---

## 5. Hand-off (human runs these)

Releases fire on tag push. `.github/workflows/publish-*.yml` run test-and-lint, build, then
`JS-DevTools/npm-publish` with `NPM_TOKEN`.

```bash
# @netgrep/search  — after bumping packages/search/Cargo.toml
git tag search-<version> && git push origin search-<version>

# @netgrep/netgrep — after bumping packages/netgrep/package.json
git tag netgrep-<version> && git push origin netgrep-<version>
```

CI is green. The workflows pin the same Rust version as `rust-toolchain.toml` and read Node from
`.node-version`, so a tag push builds what you built locally.

---

## 6. Report back

State plainly: which targets you ran and their results, the built artefact sizes, which version bumps are
needed and where, the exact tag commands to run, and the CI warning if Rust is involved. If a target failed,
say so with the output — do not report a release as ready when it is not.
