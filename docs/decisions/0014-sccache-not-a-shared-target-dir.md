# 0014 — Cache Rust builds with sccache, and never with a shared target directory

**Status:** Accepted (2026-07-29). Supersedes the "no build-cache configuration" half of
[0012](0012-worktree-bootstrap.md), and **retracts the `CARGO_TARGET_DIR` advice** that record and
`CONTRIBUTING.md` used to give.

## Context

Cargo keeps `target/` inside each worktree, so every worktree recompiles the whole ripgrep dependency tree:
~9s for the wasm32 release build, ~10s for the native test build, hundreds of megabytes each, for artefacts
that are identical between worktrees.

[0012](0012-worktree-bootstrap.md) left this to the developer — `export CARGO_TARGET_DIR=…` in a shell
profile, with `bootstrap.mjs` printing a suggestion once a second worktree existed. Two things were wrong
with that.

**The smaller problem: nobody was there to set it.** It assumed a human running `pnpm worktree` in a shell
whose profile they control. Worktrees here are increasingly created by tooling — agent harnesses, editor
integrations, `git worktree add` typed directly — which never runs bootstrap, never sees the suggestion, and
does not inherit a variable nobody exported. 0012 listed this as a cost; it turned out to be the common path.

**The larger problem: the advice was unsafe.** This was found while implementing the automatic version of it,
and it is the reason this record exists at all.

### A shared `CARGO_TARGET_DIR` silently runs another worktree's binary

Two worktrees of one clone hold the same package at the same version. Cargo's unit hash does not include the
worktree path, so both produce the same output filenames *and the same fingerprint keys* in the shared
directory. Build in worktree B, then test in worktree A, and Cargo reports everything fresh and runs B's
artefact.

Reproduced here on 2026-07-29, with `CARGO_TARGET_DIR` shared between two worktrees of this repository:

```
worktree B (25 tests) $ cargo test -p search     →  Compiling search…  25 passed
worktree A ( 2 tests) $ cargo test -p search     →  Finished in 0.03s   2 passed   ← A's own suite, not run
```

No recompile, no warning, no way to notice from the output. Touching a source file recovers it, which is
exactly what makes it dangerous: it looks fine most of the time.

CI cannot catch this — CI has one checkout. It is a purely local failure, in the one situation the cache
exists to serve, and it silently substitutes test results.

This is not a flaw in how 0012 phrased the suggestion. It is inherent to sharing a target directory between
checkouts of the same package, so *any* form of that advice is unsafe.

## Decision

**`scripts/cargo-cache.mjs` wraps every cargo and wasm-pack invocation the repository makes** — the `build`,
`test` and `lint` scripts of `packages/search` — and sets `RUSTC_WRAPPER=sccache` when sccache is available.

Each worktree keeps its own `target/`. There is no shared output directory, so there is nothing to collide:
sccache keys cached objects by content, hands back the ones it has, and Cargo does its own bookkeeping per
worktree. `CARGO_INCREMENTAL=0` comes with it, because sccache cannot cache incremental compilation; that
costs nothing here, since the only first-party crate is ~45 lines and incremental never applied to the
dependencies that are the whole expense.

Measured on a fresh worktree with a warm cache:

| Build | Cold | Warm sccache | Shared target dir (rejected) |
|---|---|---|---|
| `cargo build --release --target wasm32-unknown-unknown` | 9.0s | **3.8s** | 0.7s |
| `cargo test -p search --no-run` | 10.1s | **4.4s** | 0.5s |

The rejected column is faster. It is also wrong, and no amount of speed compensates for silently running the
wrong binary.

The wrapper stands aside and leaves the command untouched when:

| Condition | Why |
|---|---|
| `sccache` is not on PATH | An external binary this repository cannot pin, so it is an optimisation and never a requirement |
| `RUSTC_WRAPPER` is set | The developer has chosen their wrapper; a repository script must not argue |
| `CI` is set | `Swatinem/rust-cache` already caches there, keyed on `target/`; a second unpinned cache would add variance |
| `NETGREP_CARGO_CACHE=0` | The escape hatch, for a genuinely cold build |

It prints one line when it engages, and — only once a second worktree exists — one line suggesting the
install when sccache is missing.

## Consequences

**Good:**
- A worktree built by tooling that will never run `pnpm bootstrap` still gets the cache.
- Safe by construction. The failure mode above cannot occur, because nothing is shared that Cargo reasons
  about.
- Degrades to exactly today's behaviour when sccache is absent, so nothing is required of a contributor.
- sccache's cache is bounded and self-evicting, and it does not serialize parallel builds — both of which a
  shared target directory gets wrong.
- The repository still commits no `.cargo/config.toml` and no absolute paths.

**Costs:**
- Roughly 2.4× rather than the ~13× a shared target directory appeared to offer. That gap is the price of
  correctness and is not negotiable.
- **Disk is not saved.** Every worktree still keeps a full `target/`. Only time is recovered.
- sccache is an unpinned external binary, installed per machine. Contributors without it see no change.
- sccache cannot cache the `cdylib` this crate produces, or proc-macro crates; measured hit rate on a fresh
  worktree was ~48% of compile requests. The dependencies, which are the cost, do cache.
- `CARGO_INCREMENTAL=0` would matter in a repository with substantial first-party Rust. Here it does not.
- One more process in the chain for every Rust command, and one more script to understand.

**Retracted:** the `export CARGO_TARGET_DIR="$HOME/.cache/cargo-shared"` recommendation in
`CONTRIBUTING.md` and [0012](0012-worktree-bootstrap.md). Anyone who followed it has been exposed to the
staleness above; both documents now say so, and say what to do instead.
