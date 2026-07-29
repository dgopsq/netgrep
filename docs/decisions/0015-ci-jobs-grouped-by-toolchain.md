# 0015 — Five CI jobs, grouped by toolchain

**Status:** Accepted (2026-07-29).

## Context

`test-and-lint.yml` was a single job running eight commands: `playwright install`, `build:wasm`, `lint`,
`typecheck`, `build`, `test`, `test:rust`, `verify:pack`.

Two costs, and only the second is about speed.

**A red build did not say what was wrong.** The check reported "Test and lint", and finding out which of the
eight commands failed meant opening the log. On a pull request the status list is the summary most people
read.

**One early failure hid every later result.** A clippy warning in the first minute meant the browser tests
never ran, so a PR touching both Rust and TypeScript needed as many round trips as it had independent
problems.

## Decision

**Five jobs, grouped by what each has to install**, plus an aggregate.

| Job | Needs | Runs |
|---|---|---|
| `wasm` | — | `build:wasm`, uploads `packages/search/pkg` as an artefact |
| `rust` | — | `lint:rust`, `test:rust` |
| `js` | — | `lint:js`, `test:unit` |
| `browser` | `wasm` | `playwright install chromium`, `test:browser` |
| `bundle` | `wasm` | `typecheck`, `build`, `verify:pack` |
| `ci` | all | Aggregate status — one check to require, one for callers to depend on |

Two jobs need `packages/search/pkg`, so it is built once and downloaded rather than rebuilt. The two that
need nothing from Rust — Biome and the unit suite, which mocks the engine — do not wait for it.

This needed the scripts split to match: `lint:js` / `lint:rust`, and `test:unit` / `test:browser` alongside
the existing `test`. The composite commands stay, because `pnpm lint` and `pnpm test` are what a contributor
types.

### Why grouped rather than one job per command

It was built the other way first — nine jobs, one per command — and measured on a real run:

| | Wall clock | Runner time |
|---|---|---|
| Original single job | ~110s | ~110s |
| One job per command (9) | **108s** | ~221s |

The parallelism bought **2 seconds**. At this repository's size the sequential version was already fast
enough that the critical path — `wasm` (45s) → `browser` (38s) → `ci` — is most of the total no matter how
the rest is arranged, and every extra job pays its own checkout, toolchain install and `pnpm install`.

So the split was worth keeping for the *naming*, not the speed, and naming is satisfied by far fewer jobs.
Grouping by toolchain is the grouping that also removes real work: five jobs install five sets of tools
instead of nine.

### Buying back the thing grouping costs

A grouped job can hide failures the same way the original single job did — `lint:rust` failing would skip
`test:rust`. **`if: '!cancelled()'` on every step after the first** removes that: the whole job runs, every
failure in it is visible in one pass, and the job still fails. It is not on `verify:pack`, which genuinely
needs `build` to have produced `dist/` first and is meaningless without it.

So the "one early failure hides the rest" problem is solved at the *step* level, where it was always a step
problem, and the job count is free to follow what actually costs money.

### Supporting changes

- **`.github/actions/node` and `.github/actions/rust`.** Repeated setup would otherwise be five places to
  edit. The Rust one also reads `channel`, `targets` and `components` out of `rust-toolchain.toml` instead of
  restating `1.97.1`, which three workflow files were quietly doing — `AGENTS.md` §3 claimed CI read the pins
  from the files, and now it does.
- **`concurrency`, cancelling superseded runs on pull requests only.** A push to `main` and a release tag are
  gates rather than feedback; cancelling one would report a green commit nothing finished checking.

The publish workflows rebuild the WASM rather than take the tested artefact. Using it would publish the exact
bytes that passed, which is a real argument — but a release should not depend on an inter-job hand-off
staying wired up, and the build is deterministic and cached. Noted in the workflow so the trade-off is not
rediscovered.

## Consequences

**Good:**
- A failed check names a toolchain rather than the whole workflow, in the PR status list, without opening a
  log.
- Independent failures within a job all surface on the same run, via `!cancelled()`.
- Roughly half the runner time of the one-job-per-command version, for the same information.
- The Rust version pin lives in `rust-toolchain.toml` only, as it was already documented to.

**Costs:**
- A red `rust` check still means "clippy or the tests", not which — one level coarser than a job per command.
  The step list in the run resolves it in one click, and `pnpm lint:rust` / `pnpm test:rust` reproduce each
  half locally.
- Five jobs still pay five checkouts and five `pnpm install`s against the original one. Roughly 2× the
  original runner time for a much better failure signal; on a repository this size that is cheap, and on a
  much larger one the grouping would want revisiting again.
- `pkg/` travels between jobs as an artefact, which is one more thing that can break, and it breaks in the
  *consumer* job. `if-no-files-found: error` moves the failure back to the producer.
- The aggregate `ci` job must treat `skipped` as failure, because a job whose `needs` failed is skipped
  rather than failed. Requiring the individual checks instead would mean editing branch protection whenever a
  job changes — which is why the aggregate exists.

**Superseded within this PR:** the nine-job version described above. It is recorded here rather than
forgotten because the measurement is the useful part — *parallelising CI in this repository does not make it
faster*, and the next person to reach for it should know that before spending the runner time.
