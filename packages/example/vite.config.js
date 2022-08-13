import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],

  optimizeDeps: {
    include: ['netgrep', 'core'],
  },
  build: {
    commonjsOptions: {
      include: [/netgrep/, /core/, /node_modules/],
    },
  },
});
