---
name: wasm-release
description: Build, verify and prepare a release of the netgrep packages (@netgrep/search WASM core and/or @netgrep/netgrep TypeScript wrapper). Use when asked to build the WASM package, cut or prepare a release, bump versions, or understand the publish pipeline. Covers the wasm-pack → post_build → git-tag → npm flow and the exact toolchain pins required.
---

# Releasing netgrep

Two independently published packages, each released by pushing a git tag. This skill covers building,
verifying and **preparing** a release.

> [!CAUTION]
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
pnpm build:wasm        # must run first: the TS package compiles against pkg/index.d.ts,
                       # and the integration tests load pkg/index_bg.wasm
pnpm lint              # Biome + clippy
pnpm typecheck
pnpm build
pnpm test              # 24 tests: 7 in Node, 17 in headless Chromium
pnpm test:rust         # 2 tests, native cargo test
pnpm verify:pack       # the tarballs that would actually reach npm
```

`pnpm verify:pack` matters most of all here, and it is the only check that looks at a release artefact.
Everything above it inspects the working tree, which is how `@netgrep/search` once published a tarball
containing no WASM at all. Never hand over a release without it passing.

`pnpm test` needs Playwright's Chromium (`pnpm exec playwright install chromium`, ~180 MB, once per machine).
It is pinned to the `playwright` version in the lockfile, so it cannot drift from its driver the way the old
ChromeDriver setup did. That half of the suite is the one that loads `pkg/` through the real fetch-based
`init()`, so it is also the closest thing to a release rehearsal short of `verify:pack`. See
[decision 0013](../../../docs/decisions/0013-playwright-for-browser-tests.md).

The example app now runs against **local workspace source**, so `pnpm dev` is a legitimate manual smoke
test. It is still not automated and does not run in CI, so it never substitutes for the targets above.

---

## 3. Build outputs

**`@netgrep/search`** — `pnpm build:wasm` runs `wasm-pack` then `scripts/post_build.js`, which marks `pkg/`
as ESM, copies the version out of `Cargo.toml`, **and deletes the `.gitignore` wasm-pack writes into
`pkg/`** — that file contains `*`, npm honours it, and it is what emptied the tarball. Do not skip the
second step.

→ `packages/search/pkg/`: `index.js`, `index_bg.js`, `index_bg.wasm` (~1.16 MB), `index.d.ts`,
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
