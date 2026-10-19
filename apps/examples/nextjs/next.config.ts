import type { NextConfig } from 'next';

// Nothing editor-specific is needed: the package is a client component and SSR-safe.
const config: NextConfig = { reactStrictMode: true };

export default config;
