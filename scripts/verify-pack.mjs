/**
 * Verify the tarballs that would actually be published.
 *
 * This exists because nothing else in the pipeline looks at them. Everything
 * CI runs — lint, typecheck, build, test — operates on the working tree, so a
 * packaging fault is invisible right up until it reaches npm.
 *
 * It was not hypothetical: `@netgrep/search` once packed to a tarball
 * containing only LICENSE, package.json and README.md. wasm-pack writes a
 * `.gitignore` holding `*` into pkg/, npm honours a package-internal
 * .gitignore when there is no .npmignore, and `"files": ["pkg"]` therefore
 * resolved to nothing. It would have installed cleanly and failed at import.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files that must be present, or the package is dead on arrival. */
const EXPECTED = {
  'packages/search': [
    'pkg/index.js',
    'pkg/index.d.ts',
    'pkg/index_bg.wasm',
    'package.json',
  ],
  'packages/netgrep': ['dist/index.js', 'dist/index.d.ts', 'package.json'],
};

const out = mkdtempSync(join(tmpdir(), 'netgrep-pack-'));
const failures = [];

/** Read the version Cargo.toml declares — the source of truth for search. */
function cargoVersion() {
  const toml = readFileSync(
    join(repoRoot, 'packages/search/Cargo.toml'),
    'utf8',
  );

  return toml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

try {
  for (const [pkgDir, expected] of Object.entries(EXPECTED)) {
    const cwd = join(repoRoot, pkgDir);

    execFileSync('pnpm', ['pack', '--pack-destination', out], {
      cwd,
      stdio: 'pipe',
    });

    const manifest = JSON.parse(
      readFileSync(join(cwd, 'package.json'), 'utf8'),
    );
    const tarball = join(
      out,
      `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
    );

    const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/^package\//, ''));

    for (const file of expected) {
      if (!entries.includes(file)) {
        failures.push(`${manifest.name}: tarball is missing ${file}`);
      }
    }

    // A `workspace:` range that survives packing would be unresolvable for
    // anyone installing from npm.
    const packed = JSON.parse(
      execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], {
        encoding: 'utf8',
      }),
    );

    for (const [dep, range] of Object.entries(packed.dependencies ?? {})) {
      if (String(range).startsWith('workspace:')) {
        failures.push(
          `${manifest.name}: dependency ${dep} still says "${range}"`,
        );
      }
    }

    console.log(`${manifest.name}@${packed.version}: ${entries.length} files`);
  }

  // Cargo.toml is the source of truth; post_build.js copies it across.
  const cargo = cargoVersion();
  const npmVersion = JSON.parse(
    readFileSync(join(repoRoot, 'packages/search/package.json'), 'utf8'),
  ).version;

  if (cargo !== npmVersion) {
    failures.push(
      `@netgrep/search version drift: Cargo.toml ${cargo} vs package.json ${npmVersion}`,
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('\nPackaging verification FAILED:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log('\nPackaging verification passed.');
