import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

/** This machine's LAN addresses, so a phone on the same Wi-Fi can open the dev server. */
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => net!.address);

const config: NextConfig = {
  reactStrictMode: true,
  // The dev badge sits on top of the editor's bottom-left controls (phone toolbar).
  devIndicators: false,
  // Agent instructions live in the repo-root CLAUDE.md + docs/internal.
  agentRules: false,
  allowedDevOrigins: [...lanAddresses, '*.local', '*.trycloudflare.com'],
  // Captions lab with ?isolated: cross-origin isolation, only so the memory breakdown API
  // (measureUserAgentSpecificMemory) works there. The editor itself never needs it (CLAUDE.md).
  // The old generated API pages (/api/index.html, /api/functions/x.html…) moved into the docs.
  // Only *.html paths: /api/assistant, /api/captions and /api/speech are route handlers.
  async redirects() {
    return [{ source: '/api/:path(.*\\.html)', destination: '/docs/api', permanent: true }];
  },
  async headers() {
    return [
      {
        source: '/lab/captions-isolated',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default config;
