import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The site is served from https://netgrep.diegopasquali.com, a custom domain,
  // so it sits at the root and this is `/`. It used to be `/netgrep/`, for the
  // project page at dgopsq.github.io/netgrep.
  //
  // Stated explicitly rather than left to Vite's default, because it is the one
  // knob that has to move if the site ever goes back onto a project page — and
  // because `src/lib/story-url.ts` composes story URLs from
  // `import.meta.env.BASE_URL`, which is exactly this value. Keeping that
  // indirection now that it resolves to `/` costs nothing and means a future
  // base change stays a one-line edit here.
  base: '/',

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
