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

```bash
export PATH="$HOME/.asdf/installs/nodejs/18.7.0/bin:$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.81.0
```

**Rust must be 1.81.0, not `stable`.** `rust-toolchain.toml` says `stable`, which is wrong and currently
broken — Rust ≥ 1.82 changed the wasm C ABI and fails against the pinned `wasm-bindgen 0.2.82`:

```
error: older versions of the `wasm-bindgen` crate are incompatible with current versions of Rust
```

Install it if missing: `rustup toolchain install 1.81.0 --target wasm32-unknown-unknown`

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
npx nx lint netgrep && npx nx test netgrep && npx nx build netgrep
npx nx lint search && npx nx build search
```

For the Rust tests, `npx nx test search` fails on a fresh machine — `wasm-pack` fetches the latest
ChromeDriver, which cannot drive an older installed Chrome (`invalid session id`). Supply a matching driver
from [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version   # match this major version
export CHROMEDRIVER=/path/to/matching/chromedriver
cd packages/search && wasm-pack test --chrome --headless
```

Expected: 7 jest tests, 2 wasm tests.

Do **not** try to verify via the example app — it runs against published npm packages, not local source.

---

## 3. Build outputs

**`@netgrep/search`** (`npx nx build search` runs both steps):

```bash
cd packages/search
wasm-pack build --scope netgrep --out-name index --release
node scripts/post_build.js     # injects "type": "module" into pkg/package.json — required, do not skip
```

→ `packages/search/pkg/` containing `index.js`, `index_bg.js`, `index_bg.wasm` (~1.0 MB), `index.d.ts`,
`package.json`. Gitignored. **`pkg/package.json` is what gets published** — `wasm-pack` generates it from
`Cargo.toml`, so the version comes from `Cargo.toml`.

**`@netgrep/netgrep`**: `npx nx build netgrep` → `packages/netgrep/dist/`. Also gitignored. `@nrwl/js:tsc`
synthesises `main`, `typings` and the `tslib` peer dependency into `dist/package.json`.

Sanity-check the emitted manifest before handing over:

```bash
cat packages/search/pkg/package.json | head -20     # correct version? "type": "module" present?
cat packages/netgrep/dist/package.json              # correct version? @netgrep/search range correct?
```

---

## 4. Version bumps — the coupling that bites

Versions live in **two hand-maintained places** with nothing enforcing agreement:

| Package | Version source | Must also update |
|---|---|---|
| `@netgrep/search` | `packages/search/Cargo.toml` | `packages/netgrep/package.json` → `dependencies["@netgrep/search"]` |
| `@netgrep/netgrep` | `packages/netgrep/package.json` | — |

So a change to the Rust core is a **two-release sequence**: publish `@netgrep/search` first, bump the
dependency range in `packages/netgrep/package.json`, then publish `@netgrep/netgrep`. Nothing checks this and
CI will not catch a mismatch.

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

**Warn the human that CI is currently broken** for anything touching Rust: the workflows install
`toolchain: stable`, which fails on `wasm-bindgen 0.2.82`. A `search-**` tag push will fail at the build step
until [`docs/BACKLOG.md`](../../../docs/BACKLOG.md) item 1 or 4 is done.

---

## 6. Report back

State plainly: which targets you ran and their results, the built artefact sizes, which version bumps are
needed and where, the exact tag commands to run, and the CI warning if Rust is involved. If a target failed,
say so with the output — do not report a release as ready when it is not.
