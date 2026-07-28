# 0010 — Vitest and Biome replace jest, ts-jest, ESLint and Prettier

**Status:** Accepted (2026-07-28).

## Context

The JS tooling was a 2022 Nx scaffold: jest 29 with ts-jest **28** (mismatched, warning on every run),
babel-jest, jest-environment-jsdom, `@types/jest`, ESLint 8 with `@typescript-eslint/*`, `eslint-config-prettier`
and Prettier 2.

Both configurations had to be rewritten regardless, because they were mostly Nx plugin wiring that died with
Nx ([0007](0007-nx-cargo-hybrid-monorepo.md)). Worth stating how little was actually at stake: **the only
hand-written ESLint rule in the entire repository was `no-console`**, and `jest.config.js` was a preset
reference plus a `globals: {'ts-jest': …}` block that ts-jest 29 had already deprecated.

The package is also **ESM-only** (`"type": "module"`, `.js` extensions on relative imports), and jest's ESM
support remains its awkward path.

## Decision

**Vitest** for tests, **Biome** for formatting and linting. Ten packages become two:

| out | in |
|---|---|
| `jest`, `ts-jest`, `babel-jest`, `jest-environment-jsdom`, `@types/jest` | `vitest` |
| `eslint`, `eslint-config-prettier`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier` | `@biomejs/biome` |

jsdom went too: nothing under test needs a DOM, only `fetch` and web streams, which Node provides. The
environment is `node`.

## Consequences

**Good:**
- Native ESM and TypeScript, no transform configuration. The suite runs in ~180 ms, down from ~1 s.
- Two dependencies instead of ten, in a repository whose defining problem was dependency rot.
- One tool for both formatting and linting, so no Prettier/ESLint conflict configuration.

**Costs:**
- Biome's rule ecosystem is smaller than ESLint's. Given the previous config contained exactly one
  hand-written rule, this is theoretical here.
- `vi.mock` factories are hoisted above the module body, so a mock referencing a local `const` needs
  `vi.hoisted()`. This is a real footgun and is commented where it occurs.
- Biome's HTML suppression comments cannot target an attribute on its own line, so the example's
  `autofocus` needs a file-scoped override in `biome.jsonc` rather than an inline ignore.

**The reformat that did not happen.** A whole-repo reformat was expected and budgeted for as a separate
commit. Biome's defaults and the previous Prettier config nearly agree, so the actual churn across the
library was **14 lines** — trailing commas and `import type`. The separate commit was dropped as noise.
