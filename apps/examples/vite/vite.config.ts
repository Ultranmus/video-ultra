import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // The engine worker is an ES module (it imports mediabunny), so workers must bundle as ES.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        editor: resolve(import.meta.dirname, 'index.html'),
        smoke: resolve(import.meta.dirname, 'smoke.html'),
      },
    },
  },
  // TSX without a plugin: esbuild's automatic React runtime.
  esbuild: { jsx: 'automatic' },
});
