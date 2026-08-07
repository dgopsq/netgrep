# Contributing

netgrep is maintained conservatively: fix defects, keep dependencies from rotting, keep it working for
existing consumers. That is most of the work, and [`docs/BACKLOG.md`](docs/BACKLOG.md) lists what is already
sanctioned.

**A feature starts as an issue, not as a pull request.** The public API is deliberately small — two functions:
`matches` answers a boolean per URL, and `grep` yields every matching line as it is found, each with its
file-absolute line number and each match's position within it. Argue the case in an issue first; if it is
accepted it lands with a decision record that also says what it does *not* open the door to.
[Decision 0020](docs/decisions/0020-the-matching-line.md) is the worked example;
[0022](docs/decisions/0022-capture-ranges.md)'s closing table, as
[0027](docs/decisions/0027-streaming-matching-lines.md) amends it, is the **current** list of match details
already refused — file-absolute byte offsets, match counts, context lines and ranking among them.

[`AGENTS.md`](AGENTS.md) is the authoritative guide to this repository — toolchain pins, the repository map,
the hard rules, the known correctness caveats. This file is the short human on-ramp; where the two overlap,
AGENTS.md wins.

## Prerequisites

Everything is pinned in a file, so you should not need to pick versions.

| Tool | Version | Where it comes from |
|---|---|---|
| Node | 24.18.0 | `.node-version` — `fnm use`, `nvm use`, or your manager of choice |
| pnpm | 11.17.0 | `corepack enable`, then it reads `packageManager` in `package.json` |
| Rust | 1.97.1 | `rust-toolchain.toml` — rustup installs it on first `cargo` call |
| wasm-pack | 0.13.1 | `cargo install wasm-pack` — the one tool you install by hand |

## First run

```bash
pnpm bootstrap
```

That is `pnpm install` followed by `pnpm build:wasm`. **Do not skip the second half.** `@netgrep/netgrep`
resolves `@netgrep/search` to this workspace, and that package points at `packages/search/pkg/` — a gitignored
build output that does not exist on a fresh clone. Until you build it, `pnpm typecheck`, `pnpm build` and the
integration tests all fail in ways that look like anything except a missing WASM build. This is the single
most common way to lose an hour here.

## Commands

All from the repository root. [AGENTS.md §4](AGENTS.md#4-commands) has the full list and the caveats.

```bash
pnpm test          # Vitest — 197 tests (60 unit and 71 tooling in Node, 66 in headless Chromium)
pnpm test:unit     # just the unit half — no WASM build and no browser needed
pnpm test:tools    # the docs generator, the guide renderer and the example's pure modules
pnpm test:browser  # just the browser half
pnpm test:rust     # cargo test — 56 tests, native, no browser
pnpm typecheck     # tsc --noEmit
pnpm lint          # Biome (JS/TS) and clippy (-D warnings); lint:js / lint:rust run one each
pnpm format        # Biome, writes in place
pnpm build:wasm    # rebuild after any change to packages/search
pnpm dev           # the log-dashboard demo — a manual smoke test, not a test
```

**`pnpm dev` generates 408.6 MB into `packages/example/public/logs/` the first time you run it**, in under a
second, by tiling four committed ~512 KB log seeds. That directory is gitignored and the step is skipped once
the files are at size, but it is a surprising amount of disk to appear in a checkout without warning — and
each worktree gets its own copy.

The integration half of `pnpm test` drives the real WASM engine in a real browser, so it needs Playwright's
Chromium. `pnpm bootstrap` installs it; on its own it is:

```bash
pnpm exec playwright install chromium     # ~180 MB, once per machine
```

It is pinned to the `playwright` version in the lockfile and is unrelated to the Chrome you have installed,
so it cannot fall out of step with its driver. That used to be this repository's most annoying local failure
— see [decision 0013](docs/decisions/0013-playwright-for-browser-tests.md).

## Working on several branches at once

```bash
pnpm worktree fix/chunk-boundary
```

Creates the branch if it does not exist, adds a git worktree **beside** this checkout (never inside it — a
nested checkout would be picked up by the pnpm workspace glob, Biome and Vitest alike), and bootstraps it.
`pnpm bootstrap` inside an existing worktree does the same preparation. Both take `--no-install`,
`--no-build` and `--no-browser`.

### Sharing the Rust build cache

Install [sccache](https://github.com/mozilla/sccache) once and every worktree stops recompiling the ripgrep
dependency tree:

```bash
brew install sccache        # or: cargo install sccache
```

That is the whole setup — no variable to export, no config to write. The `build`, `test` and `lint` scripts
of `packages/search` go through `scripts/cargo-cache.mjs`, which sets `RUSTC_WRAPPER=sccache` for you when it
finds it (along with `CARGO_INCREMENTAL=0`, which sccache requires). It prints one line when it engages, so a
build going through a wrapper you did not configure is never a mystery. Measured on a fresh worktree with a
warm cache:

| | Cold | With sccache |
|---|---|---|
| `pnpm build:wasm`'s cargo step | 9.0s | **3.8s** |
| `pnpm test:rust`'s compile | 10.1s | **4.4s** |

Without sccache, nothing changes and nothing breaks — it is an optimisation, not a requirement. It also works
in a worktree you created with plain `git worktree add`, which is the point: worktrees created by tooling
never run `pnpm bootstrap`.

Your environment wins: the wrapper leaves the command completely alone if `RUSTC_WRAPPER` is already set, and
`NETGREP_CARGO_CACHE=0` opts out entirely.

Note this saves **time, not disk** — each worktree still keeps its own `target/`. `cargo clean` in a worktree
reclaims that one; sccache's own cache is bounded and evicts itself.

> [!WARNING]
> **Do not share one `CARGO_TARGET_DIR` between worktrees.** This file used to recommend exactly that, and
> the advice was wrong. Two worktrees of this repository hold the same package at the same version, and
> Cargo's unit hash does not include the worktree path, so they collide on both output filenames and
> fingerprint keys — build in one worktree and the other reports everything fresh and **runs the first one's
> binary**. Reproduced here: a 25-test suite silently replaced by a 2-test one, in 0.03s, with no recompile
> and no warning. Touching a source file recovers it, which is what makes it dangerous. If you have this in
> your shell profile, remove it.
>
> [Decision 0014](docs/decisions/0014-sccache-not-a-shared-target-dir.md) has the full write-up and the
> retraction of [0012](docs/decisions/0012-worktree-bootstrap.md)'s version of the advice.

## Before opening a pull request

```bash
pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:rust &&
  pnpm docs:sync --check && pnpm verify:pack
```

That is everything CI checks. `pnpm build` is not optional here even though nothing else needs it:
`verify:pack` inspects the tarballs that would reach npm, and `packages/netgrep/dist/` has to exist first.

CI groups these into **five jobs by toolchain** — `wasm`, `rust`, `js`, `browser`, `bundle` — so a red check
names the tools rather than the whole workflow, and the step list inside it names the command.
`pnpm lint:js`, `pnpm lint:rust`, `pnpm test:unit`, `pnpm test:tools` and `pnpm test:browser` reproduce the
halves locally. See
[AGENTS.md §4.3](AGENTS.md#43-what-ci-runs-and-where-a-red-check-comes-from).

Then, in rough order of how likely each is to bite:

- **Some tests assert behaviour that is deliberately wrong.** `grep.integration.spec.ts` and
  `matches.integration.spec.ts` each end with a block titled *documented defects*, and
  `packages/search/tests/search.rs` has a `documented_defects` module. They pin known bugs — a match longer
  than the 64 KB tail ceiling still spanning a chunk boundary, `^`/`$` also anchoring to a bare `\r`. Several
  are labelled `(FIXED)` and assert *correct* behaviour, inverted in place
  with a note about what they used to claim; that is the block recording its own history, not clutter. If one
  fails, something changed the engine; work out what, and if the new behaviour is right, **invert the
  assertion in the same PR** with a note. Do not quietly "fix" the test.
  [AGENTS.md §2.1](AGENTS.md#21-some-tests-assert-behaviour-that-is-wrong-on-purpose) has the full story.
- **Fixing a defect also means updating the demo site.** <https://netgrep.diegopasquali.com/docs/> lists the
  defects that affect its visitors, so a fix that leaves the list alone ships a page warning about a bug
  that no longer exists. Every limitation lives once, in `docs/guide/caveats.data.json`: delete the entry and
  run `pnpm docs:sync`, in the same PR. **CI catches this now** — `pnpm docs:sync --check` fails if the guide
  or the README has drifted from that file. What it cannot catch is a defect nobody entered into it
  in the first place, so adding one is still yours to judge. (The demo's timings measure the network, and
  since [decision 0024](docs/decisions/0024-remove-the-in-memory-cache.md) removed the in-memory cache that is
  true by construction — there is no flag to set and nothing retained that could be timed instead of a fetch.
  Do not add a layer in the demo that answers a repeat query from memory.)
  [AGENTS.md §2.3](AGENTS.md#23-️-fixing-a-defect-is-not-finished-until-the-demo-site-stops-warning-about-it).
- **Do not bump dependencies as a side effect.** A version change is its own deliberate, tested change. If a
  tool suggests one while you are doing something else, add it to `docs/BACKLOG.md`.
- **Do not commit build outputs or lockfile churn.** `packages/netgrep/dist/` and `packages/search/pkg/` are
  gitignored; if a command rewrites `pnpm-lock.yaml` incidentally, revert it.
- **ESM only, and relative imports carry a `.js` extension** even though the sources are `.ts`.
  `moduleResolution` is `nodenext`, which requires it.
- **Comments explain *why*.** Several places in this repository look wrong and are not; they are commented
  for a reason. Keep that density — but keep them short: make the point in the first sentence and stop.
- **And keep them standalone.** A comment should not send you to a document to find out what it means — no
  `see decision 0018`, no `see caveat 2`. Delete the reference and check the comment still stands; if it does
  not, write the missing sentence rather than the pointer. Cross-references rot and nothing checks them. Bare
  backlog item numbers are fine, since they are stable labels rather than explanations. Long-form rationale
  still lives in [`docs/decisions/`](docs/decisions/) — that is what keeps comments short — but the comment has
  to make sense without it.

## Commit messages decide what gets released

This repository uses [Conventional Commits](https://www.conventionalcommits.org/), and since releases are cut
by [release-please](https://github.com/googleapis/release-please) they are not just a convention any more —
the type in your subject line decides whether your change ships at all.

| Type | Releases? | In the changelog? |
|---|---|---|
| `fix:` | patch | yes |
| `feat:` | minor | yes |
| `feat!:` / `BREAKING CHANGE:` | minor, while the version is `0.x` | yes, called out |
| `perf:`, `refactor:`, `build:`, `deps:` | patch | yes |
| `chore:`, `docs:`, `ci:`, `test:`, `style:` | no | no |

Two traps worth knowing before you pick one:

- **Toolchain or dependency work that changes the published bytes is a `fix`, not a `chore`.** Dropping the
  ripgrep fork moved the `.wasm` by ~342 KB and silently fixed a bug; committed as `chore:` it would neither
  release nor appear anywhere a consumer looks.
- **A change to the demo that a visitor can see is `fix(example):` or `feat(example):`, not `docs:`.** The
  site deploys on release, so a `docs:`-typed copy fix will sit on `main` until something else releases.
  `docs:` is for repository documentation.

Scope by package — `search`, `netgrep`, `example` — though release-please picks the component from the paths
you touched, not from the scope.

## Releases

Releases are cut by release-please. It keeps a "chore: release netgrep" pull request up to date as commits land;
merging it tags, publishes both npm packages and deploys the demo, in one run and in that order.

**Version bumps and publishing are maintainer-only** — please do not include them in a pull request. Do not
edit versions in `Cargo.toml`, `package.json` or `.release-please-manifest.json` by hand either; those files
are written by the bot, and an edit makes them drift in a way `pnpm verify:pack` fails on.

## Where things live

[AGENTS.md §5](AGENTS.md#5-repository-map) maps the three packages and says which file to change for which
kind of goal. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the design and the known correctness
caveats; [`docs/decisions/`](docs/decisions/) explains why the system is shaped the way it is.
