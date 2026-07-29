import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The site is served from https://dgopsq.github.io/netgrep, so every asset
  // and every story URL sits under `/netgrep/`. Nothing may hard-code a
  // leading-slash path: use `import.meta.env.BASE_URL` via `src/lib/story-url.ts`,
  // which is the single place that knows about this.
  //
  // `pnpm dev` serves at http://localhost:5173/netgrep/ for the same reason —
  // matching production is worth more than a shorter dev URL, because a
  // base-path mistake then fails locally instead of only after deploying.
  base: '/netgrep/',

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
