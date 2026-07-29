/**
 * Run a Cargo-driven command through a compiler cache shared by every worktree,
 * when one is available.
 *
 * WHY THIS EXISTS
 * ---------------
 * Cargo keeps `target/` inside each worktree, so every worktree compiles the
 * whole ripgrep dependency tree again — ~9s for the wasm32 release build, ~10s
 * for the native test build, per worktree, for artefacts that are identical.
 *
 * Decision 0012 left that to the developer: `export CARGO_TARGET_DIR=…` in a
 * shell profile. That assumed worktrees are created by a human running
 * `pnpm worktree`, in a shell whose profile they control. Increasingly they are
 * not — agents and tooling create them with `git worktree add` directly, never
 * run bootstrap, and never read CONTRIBUTING.md. So the cache is arranged here,
 * where every worktree gets it whether or not anyone set anything up.
 *
 * WHY NOT CARGO_TARGET_DIR — READ THIS BEFORE "SIMPLIFYING" IT
 * -----------------------------------------------------------
 * Pointing `CARGO_TARGET_DIR` at one directory shared by all worktrees is
 * faster than what this does — 0.5s rather than 3.8s, measured — and it is
 * **wrong**. Two worktrees of one clone hold the same package at the same
 * version, and Cargo's unit hash does not include the worktree path, so they
 * produce the same output filenames and the same fingerprint keys. Build in
 * worktree B, then test in worktree A, and Cargo reports everything fresh and
 * **runs B's binary**. Reproduced here on 2026-07-29: worktree A's 25-test
 * suite silently ran B's 2-test one, with no recompile and no warning.
 *
 * A wrong answer that fast is worse than a slow correct one, and it is
 * invisible — which is exactly the failure mode CI exists to catch and would
 * not, because CI has one checkout. See decision 0014.
 *
 * WHAT IT DOES INSTEAD
 * --------------------
 * Sets `RUSTC_WRAPPER=sccache`, leaving each worktree its own `target/`. There
 * is no shared output directory, so there is nothing to collide: sccache keys
 * cached objects by content, hands back the ones it has, and Cargo still does
 * its own bookkeeping per worktree. Measured on a fresh worktree with a warm
 * cache: the wasm32 release build 9.0s → 3.8s, `cargo test --no-run` 10.1s →
 * 4.4s. sccache's own cache is bounded and self-evicting, unlike a target
 * directory.
 *
 * `CARGO_INCREMENTAL=0` comes with it — sccache cannot cache incremental
 * compilation and asks to be told not to try. It costs nothing here: the only
 * first-party crate is ~45 lines, and incremental never applied to the
 * dependencies that make up the whole cost.
 *
 * It stands aside, leaving the command untouched, whenever:
 *
 *   - `sccache` is not on PATH — it is an external binary this repository
 *     cannot pin, so it is an optimisation, never a requirement;
 *   - `RUSTC_WRAPPER` is already set — the developer has chosen their wrapper,
 *     and this must not argue;
 *   - `CI` is set — `Swatinem/rust-cache` already caches there, keyed on
 *     `target/`, and a second unpinned cache would only add variance;
 *   - `NETGREP_CARGO_CACHE=0` — the escape hatch, for reproducing something
 *     against a genuinely cold build.
 *
 * Usage:
 *   node scripts/cargo-cache.mjs <command> [args...]
 */
import { execFileSync, spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('usage: node scripts/cargo-cache.mjs <command> [args...]');
  process.exit(2);
}

/** Whether `sccache` can be run, as opposed to merely existing on PATH. */
function hasSccache() {
  try {
    execFileSync('sccache', ['--version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/** How many worktrees this clone has, or 1 if that cannot be determined. */
function worktreeCount() {
  try {
    return execFileSync('git', ['worktree', 'list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n').length;
  } catch {
    return 1;
  }
}

const env = { ...process.env };

if (
  process.env.NETGREP_CARGO_CACHE === '0' ||
  process.env.RUSTC_WRAPPER ||
  process.env.CI
) {
  // Deliberately silent. Each of these means somebody has already decided, and
  // a line of output per cargo invocation saying so would be noise.
} else if (hasSccache()) {
  env.RUSTC_WRAPPER = 'sccache';
  env.CARGO_INCREMENTAL = '0';

  // Said out loud, because a build going through a wrapper you did not
  // configure should not be a mystery when it behaves oddly.
  console.log('compiler cache: sccache (shared across worktrees)');
} else if (worktreeCount() > 1) {
  // Only once a second worktree exists. Before that there is nothing to share
  // with, and suggesting an install would be nagging.
  console.log(
    'No sccache on PATH — this worktree will recompile the dependency tree.',
  );
  console.log('`brew install sccache` (or `cargo install sccache`) shares it.');
}

// `spawn` rather than `execFileSync` so signals reach the child and its exit
// code — including one from a signal — is reproduced faithfully. `shell: true`
// on Windows because npm-installed binaries are `.cmd` shims there.
const child = spawn(command, args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  console.error(`cargo-cache: could not run ${command}: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
