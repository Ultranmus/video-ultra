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
};

export default config;
