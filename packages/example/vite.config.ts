import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { guidePlugin } from './plugins/guide';
import { wasmPreloadPlugin } from './plugins/wasm-preload';

export default defineConfig({
  // The site is served from https://www.netgrep.dev, a custom domain,
  // so it sits at the root and this is `/`. It used to be `/netgrep/`, for the
  // project page at dgopsq.github.io/netgrep.
  //
  // Stated explicitly rather than left to Vite's default, because it is the one
  // knob that has to move if the site ever goes back onto a project page — and
  // because `src/data/logs.ts` composes log file URLs from
  // `import.meta.env.BASE_URL`, which is exactly this value. Keeping that
  // indirection now that it resolves to `/` costs nothing and means a future
  // base change stays a one-line edit here.
  base: '/',

  // Two real documents, not a client-side router: /docs is generated HTML that
  // reads without JavaScript, and `mpa` turns off the SPA fallback that would
  // otherwise serve index.html for an unknown path and hide a broken link.
  appType: 'mpa',

  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs/index.html', import.meta.url)),
      },
    },
  },

  plugins: [react(), tailwindcss(), guidePlugin(), wasmPreloadPlugin()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
