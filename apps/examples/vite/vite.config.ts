import { defineConfig } from 'vite';

export default defineConfig({
  // The engine worker is an ES module (it imports mediabunny), so workers must bundle as ES.
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
