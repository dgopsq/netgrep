# AGENTS.md

Operating guide for AI agents working in the **netgrep** repository.
Canonical source — `CLAUDE.md` points here. Keep this file authoritative; do not fork its content.

> ## ⚠️ Partially out of date — migration in progress
>
> A modernization is landing across five PRs; see [`docs/plans/MODERNIZATION.md`](docs/plans/MODERNIZATION.md).
> This file is rewritten in the final one. Until then, **§2, §3 and §4 are stale**:
>
> | this file says | reality |
> |---|---|
> | Nx + yarn (`yarn nx test netgrep`) | Nx and yarn are gone. Use pnpm: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:wasm`, `pnpm build:wasm`, `pnpm build:wasm-node` |
> | Node 18.7.0 | Node 24 LTS, pinned in `.node-version` |
> | jest / ESLint / Prettier | Vitest + Biome |
> | §2: local edits never reach the TS package or the example | **Fixed.** pnpm workspaces link them; the example bundles local source |
>
> Rust is untouched so far: still `wasm-bindgen 0.2.82` on the pinned Rust 1.81.0, still the ripgrep fork.
> Everything in §6 (hard rules) and §7 (correctness caveats) still applies.

---

## 1. What this project is

netgrep is an **experimental** port of [ripgrep](https://github.com/BurntSushi/ripgrep) to WebAssembly that
searches remote files **over HTTP while they are still downloading**. It answers exactly one question:
*does this pattern occur in the file at this URL?* — a boolean, nothing more.

The intended use case is a client-side search engine over a small, static, file-based corpus
(e.g. Markdown posts emitted by a static site generator), as an alternative to standing up an index-based
search backend.

**Project status: maintenance only.** Keep it building, keep it correct, keep dependencies from rotting.
Do not propose or implement new features. See [`docs/BACKLOG.md`](docs/BACKLOG.md) for sanctioned work.

---

## 2. ⚠️ Read this before you edit anything

**Local source edits do not reach the example app or the TypeScript package.** This repo has no linking
between its own packages. Verified on 2026-07-28:

- The root `package.json` declares **no yarn workspaces**.
- The root `yarn.lock` pins `@netgrep/netgrep@0.1.3` and `@netgrep/search@0.1.2` — *published 2022 copies of
  this repo's own packages*, fetched from the npm registry. After `yarn install`, that is literally what sits
  in `node_modules/@netgrep/`.
- `packages/netgrep/yarn.lock` pins `@netgrep/search@^0.1.5` **from npm**. The locally built WASM output
  (`packages/search/pkg/`, gitignored) is never linked into it.
- `packages/example/webpack.config.js` has no `resolve.alias` and no tsconfig-paths plugin, and the example is
  plain JavaScript — so it resolves `@netgrep/netgrep` from `node_modules`, i.e. **version 0.1.3 from 2022**.

**Consequences you must internalise:**

| You edit… | What actually changes |
|---|---|
| `packages/search/src/lib.rs` | Only `packages/search/pkg/` after a rebuild, and the Rust tests. **Not** `packages/netgrep`. **Not** the example. |
| `packages/netgrep/src/**` | Only `packages/netgrep/dist/` and the jest suite. **Not** the example. |

So: rebuilding the WASM and then running the example proves **nothing**. If you "verify" a change that way you
will observe 2022 behaviour and draw a false conclusion. This is the single most expensive trap in this repo.

**Verify changes with the test suites instead** (§4). If you genuinely need an end-to-end check, you must wire
the packages together manually (`yarn link`, or a temporary `file:` dependency, or publishing) — and that
wiring is *not* committed, so revert it before you finish.

The disconnect is **known and deliberately left as-is**. Do not "fix" it as a side effect of another task.

---

## 3. Toolchain

Exact versions matter here; this project is pinned to 2022 and several pins are load-bearing.

| Tool | Version | Notes |
|---|---|---|
| Node | **18.7.0** | Per `.node-version`. Nx 14 is not expected to work on modern Node. |
| yarn | 1.x (classic) | Verified with 1.22.22. |
| Rust | **1.81.0** | **NOT `stable`.** See the warning below. |
| wasm-pack | 0.13.1 | Verified. |
| Rust target | `wasm32-unknown-unknown` | `rustup target add wasm32-unknown-unknown` |
| ChromeDriver | must match your installed Chrome **major** version | Needed only for `nx test search`. |

### ⚠️ `rust-toolchain.toml` says `stable` and that is broken

`rust-toolchain.toml` pins `channel = "stable"`, which resolves to whatever stable is today. On current stable
(verified with 1.97.1) the build fails:

```
error: older versions of the `wasm-bindgen` crate are incompatible with current versions of Rust;
       please update to `wasm-bindgen` v0.2.88
```

Rust 1.82 changed the wasm C ABI; `wasm-bindgen 0.2.82` (pinned in `packages/search/Cargo.toml`) predates that.
**1.81.0 is the last Rust that compiles this project.** Use it explicitly:

```bash
rustup toolchain install 1.81.0 --target wasm32-unknown-unknown
export RUSTUP_TOOLCHAIN=1.81.0     # or prefix commands with `cargo +1.81.0`
```

**This also means CI is currently broken** — `.github/workflows/*.yml` install `toolchain: stable`. Any push
that triggers a Rust build today fails at this error. Tracked in [`docs/BACKLOG.md`](docs/BACKLOG.md).

---

## 4. Commands

All verified end-to-end on 2026-07-28 (macOS arm64, Node 18.7.0, Rust 1.81.0) unless noted.

```bash
# One-time
yarn install                       # root; also `cd packages/netgrep && yarn install` if working there
```

| Target | Command | Status |
|---|---|---|
| Lint TS | `npx nx lint netgrep` | ✅ passes |
| Test TS | `npx nx test netgrep` | ✅ 7 tests pass (jest, jsdom) |
| Build TS | `npx nx build netgrep` | ✅ → `packages/netgrep/dist/` |
| Lint Rust | `npx nx lint search` | ✅ passes (clippy, `failOnWarnings: true`) |
| Build WASM | `npx nx build search` | ✅ → `packages/search/pkg/`, **1.0 MB** `index_bg.wasm` |
| Test Rust | `npx nx test search` | ⚠️ see below |
| Run example | `npx nx serve example` | Demo only — see §2. Not a verification tool. |

Rust commands require `RUSTUP_TOOLCHAIN=1.81.0` in the environment.

### `nx test search` fails out of the box

The target runs `wasm-pack test --chrome --headless`. wasm-pack downloads the *latest* ChromeDriver, which will
not drive an older installed Chrome. Observed failure: ChromeDriver 151 vs Chrome 150 →
`invalid session id`, driver killed with signal 9.

Workaround — supply a matching driver from
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/):

```bash
export CHROMEDRIVER=/path/to/matching/chromedriver
export RUSTUP_TOOLCHAIN=1.81.0
cd packages/search && wasm-pack test --chrome --headless
```

With a matching driver the suite passes: **2 tests**, verified.

---

## 5. Repository map

Three packages, ~400 lines of first-party source in total. Nx orchestrates both the JS and Rust builds.

```
packages/
  search/            Rust → WASM core. The actual search engine.
    src/lib.rs         48 lines. Exports one function: search_bytes(&[u8], &str) -> bool
    tests/search.rs    wasm-bindgen tests, run in headless Chrome
    scripts/post_build.js   adds "type": "module" to the generated pkg/package.json
    pkg/               BUILD OUTPUT, gitignored
    → published as @netgrep/search

  netgrep/           TypeScript wrapper. Streaming + batching + caching.
    src/lib/Netgrep.ts        the whole public API (~200 lines)
    src/lib/data/*.ts         5 type definitions, one per file
    src/lib/Netgrep.spec.ts   jest suite; mocks both fetch and the WASM module
    dist/              BUILD OUTPUT, gitignored
    → published as @netgrep/netgrep

  example/           Webpack 5 demo searching ~60 Sherlock Holmes .txt files.
                     Not published. Not a test. Runs against npm, not local source.
```

Root config: `nx.json` / `workspace.json` (Nx), `Cargo.toml` (Rust workspace),
`tsconfig.base.json`, `.eslintrc.json`, `jest.config.ts`, `.github/workflows/`.

### Where to change what

| Goal | File |
|---|---|
| Change matching semantics (regex flags, case sensitivity, binary handling) | `packages/search/src/lib.rs` |
| Change what a result contains | `packages/search/src/lib.rs` **and** `packages/netgrep/src/lib/data/NetgrepResult.ts` |
| Change streaming, batching, caching, abort behaviour | `packages/netgrep/src/lib/Netgrep.ts` |
| Add/adjust a config option | `packages/netgrep/src/lib/data/NetgrepConfig.ts` or `NetgrepSearchConfig.ts` |
| Change build/publish steps | `packages/*/project.json`, `.github/workflows/` |

---

## 6. Hard rules

1. **Never bump dependencies opportunistically.** The 2022 pins are interlocked:
   Nx 14 ↔ `@nrwl/*` scope ↔ Node 18, and `wasm-bindgen 0.2.82` ↔ Rust ≤ 1.81 ↔ the ripgrep fork.
   Any version change is its own deliberate, tested task — never a side effect of unrelated work.
   If a tool suggests an upgrade while you are doing something else, note it in `docs/BACKLOG.md` and move on.

2. **Never edit the ripgrep fork from this repository.** It lives in a separate repo,
   [`dgopsq/ripgrep`](https://github.com/dgopsq/ripgrep), consumed as a git dependency pinned to tag
   `13.0.0-wasm`. There is no vendored copy here to patch. Changing it requires:
   fork repo → commit → **new tag** → bump the `tag = "…"` in `packages/search/Cargo.toml` → rebuild.
   See [`docs/decisions/0001-fork-ripgrep-for-wasm.md`](docs/decisions/0001-fork-ripgrep-for-wasm.md) for
   exactly what the fork changes.

3. **Version bumps and publishing are human-only.** Releases fire from pushed git tags
   (`netgrep-**`, `search-**`) and publish to npm under the maintainer's token. You may *prepare* a release;
   you may never trigger one, push a release tag, or run `npm publish` / `wasm-pack publish`.

4. **The example app is a demo, not a test.** It proves nothing about local code (§2). Correctness is
   established only by `nx test netgrep` (jest) and `nx test search` (wasm-bindgen in headless Chrome).

5. **Do not commit build outputs or lockfile churn.** `packages/netgrep/dist/` and `packages/search/pkg/` are
   gitignored. If `yarn install` or `cargo` rewrites a lockfile as a side effect, revert it.

---

## 7. Known correctness caveats

These are real, present in the published `@netgrep/netgrep@0.1.5`, and **documented rather than fixed**.
Read [`docs/ARCHITECTURE.md §Known limitations`](docs/ARCHITECTURE.md#known-limitations--correctness-caveats)
before touching search or caching logic — the two bugs interact, and fixing one naively reintroduces the other.

- **Chunk-boundary false negatives** — `packages/netgrep/src/lib/Netgrep.ts:71`
- **Poisoned partial cache** — `packages/netgrep/src/lib/Netgrep.ts:76`, `:80`, `:89-91`
- **Unbounded cache growth**, **per-chunk regex recompilation**, **panic on invalid pattern** — see the doc.

---

## 8. Conventions

- **TypeScript**: ESM only, `"type": "module"`. Relative imports carry the **`.js` extension**
  (`./data/NetgrepResult.js`) even though the sources are `.ts` — required for ESM output. Match this.
- One type per file under `src/lib/data/`, named after the type.
- TSDoc comments on every public method and type. Keep that density.
- Prettier + ESLint for TS; rustfmt + clippy for Rust. Clippy runs with `failOnWarnings: true`.
- `.editorconfig` is authoritative for whitespace.

---

## 9. Further reading

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, data flow, build/release pipeline, known limitations |
| [`docs/decisions/`](docs/decisions/) | Why the system is shaped this way — one record per decision |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Sanctioned maintenance work, prioritised |
| [`README.md`](README.md) | Public-facing usage docs. Audience is library consumers, not contributors. |
