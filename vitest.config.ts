import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // The unit suite mocks `fetch` AND the engine, so it never executes a
        // line of Rust and never touches a DOM. Node is the right environment
        // for it: no browser to boot, and everything it reaches for (web
        // streams, `fetch`) Node provides natively.
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/netgrep/src/**/*.spec.ts'],
          exclude: ['**/*.integration.spec.ts'],
        },
      },
      {
        // The integration suite drives the real WASM engine, so it runs in a
        // real browser — the environment the library actually ships to.
        //
        // Playwright downloads a Chromium pinned to its own package version,
        // so the browser and the thing driving it can never drift apart. That
        // is why this replaced `wasm-pack test --chrome --headless`, which
        // fetched the newest ChromeDriver and then could not drive an older
        // locally installed Chrome. See decision 0013.
        test: {
          name: 'browser',
          include: ['packages/netgrep/src/**/*.integration.spec.ts'],
          // Turns a missing `pkg/` into "run pnpm build:wasm" rather than an
          // unresolved-import stack trace. See the file for why it cannot be
          // a check inside the test itself.
          globalSetup: ['./vitest.global-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
        // `@netgrep/search` must reach the browser as the file wasm-pack
        // emitted it. Vite's dependency pre-bundling would rewrite it into
        // `.vite/deps/`, and the loader resolves the binary RELATIVE to its
        // own module URL (`new URL('index_bg.wasm', import.meta.url)`), so a
        // moved module would fetch the `.wasm` from a directory that has none.
        //
        // This is the same class of failure as decision 0005, where the
        // `bundler` target broke silently under Vite and every search returned
        // `false`.
        optimizeDeps: {
          exclude: ['@netgrep/search'],
        },
      },
      {
        // Build-time tooling and the example's pure modules: the docs
        // generator, the guide renderer, `active-heading.ts`.
        // None of these touch the library, `pkg/` or a browser — so this
        // project boots nothing. It is separate from `unit` rather than
        // folded into it because that project's include path is the
        // library's source, and widening it would blur what a red
        // `test:unit` means.
        test: {
          name: 'tools',
          environment: 'node',
          include: ['scripts/**/*.spec.mjs', 'packages/example/**/*.spec.ts'],
        },
      },
    ],
  },
});
