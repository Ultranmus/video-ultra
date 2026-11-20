import { defineConfig } from 'tsup';

export default defineConfig({
  // The worker is its own entry so it lands next to the code that loads it:
  // `new Worker(new URL('./lab.worker.js', import.meta.url))` — every output file sits flat in dist/.
  entry: {
    index: 'src/index.ts',
    internal: 'src/internal.ts',
    'lab.worker': 'src/lab/worker.ts',
    'engine.worker': 'src/engine/worker.ts',
    'analyzer.worker': 'src/media/analyzer-worker.ts',
    'storage.worker': 'src/storage/worker.ts',
    'proxy.worker': 'src/media/proxy-worker.ts',
    'probe.worker': 'src/probe-worker.ts',
    // AudioWorklet module: loaded with addModule(), copied as-is by bundlers (no imports inside).
    'audio.worklet': 'src/audio/worklet.ts',
  },
  splitting: true,
  format: ['esm'],
  // tsup's dts step sets `baseUrl`, which TS 6 flags as deprecated.
  dts: {
    entry: { index: 'src/index.ts', internal: 'src/internal.ts' },
    compilerOptions: { ignoreDeprecations: '6.0', stripInternal: true },
  },
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
