import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { dripServer } from './vitest.drip-server.js';

// Vite does not read tsconfig's `customConditions`, so the projects that run
// the library FROM SOURCE need `#wasm-boot` pointed at the source boot module
// explicitly. Without it they resolve into `dist/`, and `pnpm test:unit` would
// start requiring a build — which AGENTS.md §2.2 says it must never do.
//
// Both projects get it, not just `unit`: the integration specs import
// `./grep.js` too. Pointing `browser` at the fetch boot is also what keeps the
// integration suite on the real loader (ARCHITECTURE.md:593).
const wasmBootSourceAlias = {
  '#wasm-boot': new URL(
    './packages/netgrep/src/lib/boot/fetch.ts',
    import.meta.url,
  ).pathname,
};

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
        resolve: { alias: wasmBootSourceAlias },
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
        resolve: { alias: wasmBootSourceAlias },
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
        // Serves the half-sent response that `streaming-transport.integration
        // .spec.ts` uses to prove bytes are searched before the response ends.
        plugins: [dripServer()],
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
          // The first `renderGuide` call instantiates Shiki's WebAssembly
          // highlighter, and that one test pays for it: 2.7s on a warm
          // developer machine against Vitest's 5s default. The margin is the
          // whole problem — a cold CI runner is several times slower and the
          // test times out, which reads as a broken guide renderer rather than
          // as a slow one. The cost is content-independent, so it does not
          // grow with the guide.
          //
          // A number with headroom, not a target: nothing here should take
          // seconds, and if something starts approaching this it is a defect
          // rather than a budget to spend.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
