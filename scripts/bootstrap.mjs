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
 * What this script deliberately does NOT do is configure a build cache.
 *
 * An earlier version wrote a `.cargo/config.toml` pointing `build.target-dir`
 * at a directory shared by every worktree, because Cargo otherwise keeps a
 * private `target/` per worktree and recompiles the whole ripgrep dependency
 * tree into each one. It worked — measurably — but a survey of comparable
 * JS+Rust repositories (oxc, rolldown, rspack, biome, swc) found that all of
 * them commit `.cargo/config.toml` for machine-agnostic settings such as
 * rustflags, and *none* of them set `build.target-dir` or a `rustc-wrapper`.
 * Machine-specific caching lives in the developer's environment there, and CI
 * caching actions assume the default `target/`.
 *
 * So the cache is an environment variable you set once, and this script only
 * reports what it found. See CONTRIBUTING.md.
 *
 * Usage:
 *   node scripts/bootstrap.mjs [--no-install] [--no-build]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));

for (const arg of args) {
  if (arg !== '--no-install' && arg !== '--no-build') {
    console.error(`bootstrap: unknown option ${arg}`);
    console.error(
      'usage: node scripts/bootstrap.mjs [--no-install] [--no-build]',
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
 * Say what Cargo will do with its build artefacts, and suggest sharing them
 * when — and only when — more than one worktree exists. A single-checkout
 * clone has nothing to share with, and nagging it would be noise.
 */
function reportBuildCache() {
  if (process.env.CARGO_TARGET_DIR) {
    console.log(`cargo target: ${process.env.CARGO_TARGET_DIR}`);
    return;
  }

  if (process.env.RUSTC_WRAPPER) {
    console.log(`compiler cache: ${process.env.RUSTC_WRAPPER}`);
    return;
  }

  const worktrees = capture('git', ['worktree', 'list']).split('\n').length;

  if (worktrees > 1) {
    console.log(
      `cargo target: ./target (private to this checkout, ${worktrees} exist)`,
    );
    console.log('Share one across worktrees with CARGO_TARGET_DIR — see');
    console.log('CONTRIBUTING.md, "Sharing a build cache".');
  }
}

reportBuildCache();

if (args.has('--no-install')) {
  console.log('skipping pnpm install (--no-install)');
} else {
  console.log('\n> pnpm install --frozen-lockfile');
  run('pnpm', ['install', '--frozen-lockfile'], repoRoot);
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

// A leftover from the generated-config approach described above. Harmless, but
// it silently redirects every build, which is exactly the confusion that
// approach was dropped for.
if (existsSync(join(repoRoot, '.cargo', 'config.toml'))) {
  console.log('\nNote: .cargo/config.toml exists and may redirect builds.');
}

console.log('\nReady. Try `pnpm test` or `pnpm dev`.');
