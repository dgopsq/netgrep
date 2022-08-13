import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), wasm()],

  optimizeDeps: {
    include: ['netgrep', 'core'],
  },

  build: {
    commonjsOptions: {
      include: [/netgrep/, /core/, /node_modules/],
    },
  },
});
