import { defineConfig } from 'tsup';

export default defineConfig({
  // Each worker is its own entry, next to the code that loads it:
  // `new Worker(new URL('./background.worker.js', import.meta.url))`.
  entry: {
    index: 'src/index.ts',
    'background.worker': 'src/background/worker.ts',
    'speech.worker': 'src/speech-detect/worker.ts',
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
