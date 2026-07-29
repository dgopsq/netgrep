# 0015 — One CI job per failure mode, with the WASM built once

**Status:** Accepted (2026-07-29).

## Context

`test-and-lint.yml` was a single job running eight commands in sequence: `playwright install`, `build:wasm`,
`lint`, `typecheck`, `build`, `test`, `test:rust`, `verify:pack`.

That has two costs, and only the second is about speed.

**A red build did not say what was wrong.** The check reported "Test and lint", and finding out which of the
eight commands failed meant opening the log. On a pull request the status list is the summary most people
read.

**One early failure hid every later result.** A clippy warning in the first minute meant the browser tests
never ran, so a PR touching both Rust and TypeScript needed as many round trips as it had independent
problems.

Against that, the reason to keep one job is real: every additional job pays for its own checkout, toolchain
install and `pnpm install`, and — if it needs the WASM — its own wasm-pack install and Rust compile. Splitting
naively would have three jobs recompiling the ripgrep tree to produce identical bytes.

## Decision

**One job per failure mode**, and the WASM built once and passed along.

| Job | Needs | Runs |
|---|---|---|
| `wasm` | — | `build:wasm`, uploads `packages/search/pkg` as an artefact |
| `lint-js` | — | `lint:js` (Biome) |
| `lint-rust` | — | `lint:rust` (clippy) |
| `test-rust` | — | `test:rust` (native `cargo test`) |
| `test-unit` | — | `test:unit` (Vitest, Node) |
| `test-browser` | `wasm` | `playwright install chromium`, `test:browser` |
| `typecheck` | `wasm` | `typecheck` |
| `package` | `wasm` | `build`, `verify:pack` |
| `ci` | all | Aggregate status — one check to require, one for callers to depend on |

Three jobs need `packages/search/pkg`, so it is built once and downloaded rather than rebuilt. The four that
need nothing from Rust — Biome, and the unit suite, which mocks the engine — do not wait for it and are
usually the first to report.

This needed the scripts split to match: `lint:js` / `lint:rust`, and `test:unit` / `test:browser` alongside
the existing `test`. The composite commands stay, because `pnpm lint` and `pnpm test` are what a contributor
types.

Two supporting changes:

- **`.github/actions/node` and `.github/actions/rust`.** Eight jobs repeating four setup steps would be eight
  places to edit. The Rust one also reads `channel`, `targets` and `components` out of `rust-toolchain.toml`
  instead of restating `1.97.1`, which three workflow files were quietly doing — `AGENTS.md` §3 claimed CI
  read the pins from the files, and now it does.
- **`concurrency`, cancelling superseded runs on pull requests only.** A push to `main` and a release tag are
  gates rather than feedback; cancelling one would report a green commit nothing finished checking.

The publish workflows rebuild the WASM rather than take the tested artefact. Using it would publish the exact
bytes that passed, which is a real argument — but a release should not depend on an inter-job hand-off
staying wired up, and the build is deterministic and cached. Noted in the workflow so the trade-off is not
rediscovered.

## Consequences

**Good:**
- A failed check names the thing that failed, in the PR status list, without opening a log.
- Independent failures all surface on the same run.
- Wall-clock is the longest chain (`wasm` → `test-browser`) rather than the sum of everything.
- The Rust version pin lives in `rust-toolchain.toml` only, as it was already documented to.

**Costs:**
- Eight jobs each pay checkout and `pnpm install` — a few minutes of runner time traded for the parallelism
  and the naming. On a repository this size that is cheap; on a much larger one it would not be.
- `pkg/` now travels between jobs as an artefact, which is one more thing that can break, and it breaks in
  the *consumer* job. `if-no-files-found: error` moves the failure back to the producer.
- The aggregate `ci` job must treat `skipped` as failure, because a job whose `needs` failed is skipped rather
  than failed. Requiring the individual checks instead would mean editing branch protection whenever a job is
  added — which is exactly why the aggregate exists.
- Nine jobs is more YAML than eight commands, offset by the two composite actions.
