import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    // tsup's dts step sets `baseUrl`, which TS 6 flags as deprecated.
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    // No clean here: watch mode would clean on every rebuild and delete the separately built
    // styles.css under the running playground. `prebuild` empties dist instead.
    clean: false,
    target: 'es2022',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    // Every export is interactive, so mark the whole bundle as a Client Component for Next.js.
    banner: { js: "'use client';" },
  },
  {
    entry: { styles: 'src/styles/index.css' },
    // Keep modern CSS (layers, container queries, nesting) as authored.
    target: 'esnext',
  },
]);
