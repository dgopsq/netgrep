/**
 * Create a git worktree and make it usable in one command.
 *
 * `git worktree add` on its own leaves a checkout that cannot build: no
 * `node_modules/`, no `packages/search/pkg/`, and a cold Cargo target. This
 * wraps it and runs `scripts/bootstrap.mjs` in the new checkout, which is where
 * the interesting part lives — read the comment at the top of that file.
 *
 * Worktrees are placed beside the main checkout rather than inside it. A nested
 * checkout would sit under the workspace glob, the Biome `**` include and the
 * Vitest include, and every one of them would pick up a second copy of the
 * sources.
 *
 * Usage:
 *   node scripts/worktree.mjs <branch> [path] [--no-install] [--no-build] [--no-browser]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = argv.filter((arg) => arg.startsWith('-'));
const positional = argv.filter((arg) => !arg.startsWith('-'));
const [branch, requestedPath] = positional;

if (!branch) {
  console.error(
    'usage: pnpm worktree <branch> [path] [--no-install] [--no-build] [--no-browser]',
  );
  process.exit(2);
}

/** Run a command for its output, trimmed. */
const capture = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8' }).trim();

// The first entry `git worktree list` reports is always the main checkout.
const mainWorktree = capture('git', ['worktree', 'list', '--porcelain'])
  .split('\n')[0]
  .replace(/^worktree /, '');

// Branch names may contain `/`, which would otherwise create a nested path.
const directoryName = `${basename(mainWorktree)}-${branch.replaceAll('/', '-')}`;
const worktreePath = resolve(
  requestedPath ?? join(dirname(mainWorktree), directoryName),
);

let branchExists = true;

try {
  capture('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
} catch {
  branchExists = false;
}

// Without an existing branch, `-b` creates one from the current HEAD, which is
// the behaviour you want when starting a piece of work.
const addArgs = branchExists
  ? ['worktree', 'add', worktreePath, branch]
  : ['worktree', 'add', '-b', branch, worktreePath];

console.log(`> git ${addArgs.join(' ')}`);
execFileSync('git', addArgs, { stdio: 'inherit' });

const bootstrap = join(worktreePath, 'scripts', 'bootstrap.mjs');

if (!existsSync(bootstrap)) {
  console.warn(
    `\nworktree: ${branch} has no scripts/bootstrap.mjs — skipping.`,
  );
  console.warn(`Set it up by hand in ${worktreePath}.`);
  process.exit(0);
}

console.log('');
execFileSync(process.execPath, [bootstrap, ...flags], {
  cwd: worktreePath,
  stdio: 'inherit',
});

console.log(`\nWorktree ready at ${worktreePath}`);
