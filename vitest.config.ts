import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The library targets browsers, but nothing under test needs a DOM: the
    // suites reach for `fetch` (replaced by a spy) and web streams, both of
    // which Node provides natively. Dropping jsdom drops a dependency.
    environment: 'node',
    include: ['packages/netgrep/src/**/*.spec.ts'],
  },
});
