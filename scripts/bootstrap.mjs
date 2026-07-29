/**
 * Prepare a checkout for work: dependencies, then the WASM build.
 *
 * This exists because a `git worktree` — or a fresh clone — starts out
 * unusable. Two of the things it needs are untracked build state:
 * `node_modules/` and `packages/search/pkg/`. The second one is the trap
 * documented in AGENTS.md §2.2: `pnpm typecheck`, `pnpm build` and the
 * integration tests all fail in ways that point anywhere but at a missing WASM
 * build, and the fix is a command you have to already know about.
 *
 * The third is Playwright's Chromium, which the integration suite runs in.
 * It lives in a shared per-user cache rather than in the checkout, so it is
 * usually already there and this step costs nothing; on a new machine it is a
 * ~180 MB download. It is here so that the closing "try `pnpm test`" is true.
 *
 * What this script does NOT do is set up the Rust build cache, because it no
 * longer has to: `scripts/cargo-cache.mjs` routes every cargo and wasm-pack
 * invocation in this repository through sccache when it is installed. That
 * happens whether or not anybody ran this script — which is the point, since
 * worktrees created by tooling never do. See decision 0014, and read it before
 * reaching for a shared CARGO_TARGET_DIR: that is faster and it silently runs
 * the wrong binary.
 *
 * All that is left here is to say what the next build will use.
 *
 * Usage:
 *   node scripts/bootstrap.mjs [--no-install] [--no-build] [--no-browser]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));

const known = new Set(['--no-install', '--no-build', '--no-browser']);

for (const arg of args) {
  if (!known.has(arg)) {
    console.error(`bootstrap: unknown option ${arg}`);
    console.error(
      'usage: node scripts/bootstrap.mjs [--no-install] [--no-build] [--no-browser]',
    );
    process.exit(2);
  }
}

/** Run a command for its output, trimmed. */
const capture = (file, argv) =>
  execFileSync(file, argv, { encoding: 'utf8' }).trim();

/** Run a command for its side effects, streaming its output through. */
const run = (file, argv, cwd) =>
  execFileSync(file, argv, { cwd, stdio: 'inherit' });

// Resolved from git rather than from this file's location: the worktree helper
// runs this script with the new worktree as its working directory.
const repoRoot = capture('git', ['rev-parse', '--show-toplevel']);

/**
 * Say what the Rust builds in this checkout will be cached by, so that a build
 * going through a wrapper nobody configured is never a mystery. The wrapper
 * itself is `scripts/cargo-cache.mjs`; this reports the same decision it will
 * make.
 */
function reportBuildCache() {
  if (process.env.NETGREP_CARGO_CACHE === '0') {
    console.log('rust cache: none (NETGREP_CARGO_CACHE=0)');
    return;
  }

  if (process.env.RUSTC_WRAPPER) {
    console.log(`rust cache: ${process.env.RUSTC_WRAPPER} (from the env)`);
    return;
  }

  try {
    capture('sccache', ['--version']);
    console.log('rust cache: sccache (shared across worktrees)');
    return;
  } catch {
    // Falls through to the suggestion below.
  }

  const worktrees = capture('git', ['worktree', 'list']).split('\n').length;

  if (worktrees > 1) {
    console.log(
      `rust cache: none — this worktree will recompile the dependency tree (${worktrees} worktrees exist)`,
    );
    console.log('`brew install sccache` (or `cargo install sccache`) shares');
    console.log('the compilation across all of them. See CONTRIBUTING.md.');
  }

  // A shared CARGO_TARGET_DIR is the obvious-looking alternative and it is
  // unsafe — see decision 0014 — so say so where somebody might be about to
  // try it.
  if (process.env.CARGO_TARGET_DIR) {
    console.log(
      `\nWARNING: CARGO_TARGET_DIR is set (${process.env.CARGO_TARGET_DIR}).`,
    );
    console.log('If it is shared with another worktree of this repository,');
    console.log("Cargo can silently run that worktree's binary instead of");
    console.log("this one's. See docs/decisions/0014.");
  }
}

reportBuildCache();

if (args.has('--no-install')) {
  console.log('skipping pnpm install (--no-install)');
} else {
  console.log('\n> pnpm install --frozen-lockfile');
  run('pnpm', ['install', '--frozen-lockfile'], repoRoot);
}

// Before the --no-build exit: skipping the WASM build is not a reason to skip
// the browser, and the download is the slow part to get out of the way.
if (args.has('--no-browser')) {
  console.log('\nskipping browser download (--no-browser)');
  console.log('`pnpm test` will fail until you run');
  console.log('`pnpm exec playwright install chromium` — see AGENTS.md §4.2.');
} else {
  console.log('\n> pnpm exec playwright install chromium');
  run('pnpm', ['exec', 'playwright', 'install', 'chromium'], repoRoot);
}

if (args.has('--no-build')) {
  console.log('\nskipping WASM build (--no-build)');
  console.log('Nothing but `pnpm install` and the unit tests will work until');
  console.log('you run `pnpm build:wasm` — see AGENTS.md §2.2.');
  process.exit(0);
}

// wasm-pack is the one tool not pinned by a file in the repo, so its absence is
// the likeliest way this step fails, and the error it produces otherwise is a
// bare ENOENT.
try {
  capture('wasm-pack', ['--version']);
} catch {
  console.error('\nbootstrap: wasm-pack is not on PATH.');
  console.error('Install it with `cargo install wasm-pack`, then re-run.');
  process.exit(1);
}

console.log('\n> pnpm build:wasm');
run('pnpm', ['build:wasm'], repoRoot);

// The repository commits no `.cargo/config.toml` (decision 0012), so one here
// is a local file — possibly a leftover from the generated-config approach that
// was tried and dropped. It takes precedence over nothing this repo does, but
// it can redirect a build silently, which is worth one line.
if (existsSync(join(repoRoot, '.cargo', 'config.toml'))) {
  console.log('\nNote: .cargo/config.toml exists and may redirect builds.');
}

console.log('\nReady. Try `pnpm test` or `pnpm dev`.');
