import { defineConfig } from 'tsup';

export default defineConfig({
  // The worker is its own entry, next to the code that loads it:
  // `new Worker(new URL('./transcribe.worker.js', import.meta.url))`.
  entry: {
    index: 'src/index.ts',
    'transcribe.worker': 'src/worker.ts',
  },
  splitting: true,
  format: ['esm'],
  dts: {
    entry: { index: 'src/index.ts' },
    compilerOptions: { ignoreDeprecations: '6.0', stripInternal: true },
  },
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
