import { defineConfig } from 'vitest/config';

// Each package keeps its own cache: the packages' tests run in parallel (turbo), and a shared
// cache directory made them race (ENOTEMPTY when one cleared it while another wrote).
export default defineConfig({ cacheDir: 'node_modules/.vite' });
