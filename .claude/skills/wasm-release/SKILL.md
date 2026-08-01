---
name: wasm-release
description: Build, verify and prepare a release of the netgrep packages (@netgrep/search WASM core and/or @netgrep/netgrep TypeScript wrapper). Use when asked to build the WASM package, cut or prepare a release, bump versions, or understand the publish pipeline. Covers the wasm-pack → post_build → release-please → npm flow and the exact toolchain pins required.
---

# Releasing netgrep

Releases are cut by **release-please**. It keeps a `chore: release main` pull request up to date as commits
land on `main`; merging that PR tags both packages, publishes them to npm in dependency order, and deploys
the demo — one run, no further confirmation. This skill covers building, verifying and **preparing**.

> [!CAUTION]
> **You may never release.** The human act is *merging the release PR*, and you may not do it — nor create a
> GitHub Release, dispatch a publish workflow, push a tag, or run any `publish` command. See
> [`AGENTS.md` §6](../../../AGENTS.md#6-hard-rules); `.claude/settings.json` denies all of them, `gh pr merge`
> included. Verify, then hand over.

> [!CAUTION]
> **You may never hand-edit a version.** `packages/search/Cargo.toml`, the two `package.json` versions, the
> root `Cargo.lock` and `.release-please-manifest.json` are written by the bot. Editing one makes them drift,
> which `pnpm verify:pack` fails on.

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

## 1. What will actually release

release-please picks components from the **paths a commit touched**, and the version from the **commit
type** — not from anything you edit.

| Changed files | Component | Effect of merging the release PR |
|---|---|---|
| `packages/search/**` | `search` | Publishes `@netgrep/search`, and `@netgrep/netgrep` with it |
| `packages/netgrep/**` | `netgrep` | Publishes both — they are locked to one version |
| `packages/example/**` | `example` | Deploys the demo site |

`search` and `netgrep` share a version through the `linked-versions` plugin, so they always release as a
pair: `workspace:*` resolves to an exact version at pack time, and a `search` release with no matching
`netgrep` release reaches no consumer. The demo deploys when **any** component releases.

| Commit type | Result |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` / `BREAKING CHANGE:` | minor while at `0.x` — never an automatic 1.0.0 |
| `perf:` `refactor:` `build:` `deps:` | patch |
| `chore:` `docs:` `ci:` `test:` | nothing at all |

A type releases if and only if it is **visible in the changelog**: release-please skips a release whose notes
come out empty, and anything visible that is not `feat` or breaking falls through to a patch bump. So the
`hidden` flags in `release-please-config.json` decide what releases, not just what is listed.

**So a `chore:` commit that changes the published bytes ships nothing.** If dependency or toolchain work
moves the `.wasm`, it is a `fix(search):`. If a change alters what a visitor sees on the demo, it is a
`fix(example):` — `docs:` will not deploy it.

---

## 2. Verify before anything else

```bash
pnpm install
pnpm build:wasm        # must run first: the TS package compiles against pkg/index.d.ts,
                       # and the integration tests load pkg/index_bg.wasm
pnpm lint              # Biome + clippy
pnpm typecheck
pnpm build
pnpm test              # 122 tests: 70 unit in Node, 52 integration in headless Chromium
pnpm test:rust         # 57 tests, native cargo test
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

→ `packages/search/pkg/`: `index.js`, `index_bg.js`, `index_bg.wasm` (~1.17 MB), `index.d.ts`,
`package.json`. Gitignored.

**What gets published is `packages/search/package.json`**, a hand-written wrapper with `"files": ["pkg"]` —
not the manifest wasm-pack generates inside `pkg/`.

**`@netgrep/netgrep`** — `pnpm build` → `packages/netgrep/dist/`, also gitignored. The published manifest is
`packages/netgrep/package.json`, hand-written, with `"files": ["dist"]`.

The version-copy step in `post_build.js` is now a **guard rather than a mechanism**: release-please writes
`Cargo.toml` and the npm wrapper in the same commit, so the two already agree. If it ever reports a sync,
something bypassed the bot.

---

## 4. Reading the release PR

The release PR is the artefact to review. Check:

- **The computed versions** in its `<details>` sections — `search` and `netgrep` must match each other.
- **The changelog entries.** They come from commit subjects, so a wrongly-typed commit shows up here as a
  missing entry, and this is the last cheap moment to notice.
- **`packages/search/Cargo.toml`, both `package.json`s and the root `Cargo.lock`** all moved together. The
  `cargo-workspace` plugin handles the lock; the `rust` strategy alone would miss it, because it only looks
  for a lock inside the package directory.

A dry run against a pushed branch, which changes nothing:

```bash
npx release-please@17.11.0 release-pr --dry-run \
  --repo-url=dgopsq/netgrep --target-branch=<branch> --token="$(gh auth token)"
```

It reads the config over the GitHub API rather than from the working tree, so the branch must be pushed
first. Do not use `--local`: it runs `git checkout` in the directory you point it at.

---

## 5. Hand-off (human does this)

There are no tag commands any more. Say:

> Merge the `chore: release main` pull request. That tags `search-<version>` and `netgrep-<version>`,
> publishes both packages, and deploys the demo.

If a publish fails **after** the tag exists, re-running `release.yml` will not retry it — release-please
reports `release_created: false` the second time and every publish job skips. The retry is a manual
`workflow_dispatch` of `publish-search.yml` or `publish-netgrep.yml` from `main`, in that order.

---

## 6. Report back

State plainly: which targets you ran and their results, the built artefact sizes, what the release PR would
contain, and the CI warning if Rust is involved. If a target failed, say so with the output — do not report
a release as ready when it is not.
