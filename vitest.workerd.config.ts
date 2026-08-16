import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// The Cloudflare Workers leg, and the reason it is a config file of its own
// rather than a fifth project in `vitest.config.ts`.
//
// `@cloudflare/vitest-pool-workers` serves workerd's module requests from a
// fallback service, and that service resolves specifiers against Vitest's ROOT
// Vite server (`ctx.vite`) — not against the server of the project being run.
// The `workerd` export condition the pool installs is therefore only in effect
// when its config IS the root config. Declared as a project inside
// `vitest.config.ts`, the pool's conditions never reach the resolver,
// `#wasm-boot` falls through to the `node` entry, and the Worker dies on
// `import.meta.resolve is not a function` — the Node boot module, loaded into a
// runtime that has no such thing.
//
// So `pnpm test:workerd` is its own invocation, like `pnpm test:deno`.
//
// Nothing here aliases `#wasm-boot`, unlike the `unit` and `browser` projects.
// The whole point of this leg is which boot module a real consumer's resolver
// picks; pointing it at source would prove nothing.

// The fixture origin. workerd has no `node:http`, so the Node spec's trick —
// start a server, hand netgrep its port — is unavailable, and netgrep calls the
// global `fetch` rather than accepting an injected one. Routing the runner
// Worker's every outbound request to a second Worker is what makes the fixture
// reachable through a perfectly ordinary `fetch(url)`.
const fixtureOrigin = 'netgrep-fixture-origin';

export default defineConfig({
  test: {
    name: 'workerd',
    include: ['packages/netgrep/tests/workerd.spec.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './packages/netgrep/tests/wrangler.toml' },
      miniflare: {
        outboundService: fixtureOrigin,
        workers: [
          {
            name: fixtureOrigin,
            modules: true,
            scriptPath: new URL(
              './packages/netgrep/tests/workerd-origin.js',
              import.meta.url,
            ).pathname,
            compatibilityDate: '2026-08-11',
          },
        ],
      },
    }),
  ],
});
