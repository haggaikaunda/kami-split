import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      '/join',
      '/sign-in',
      '/account',
      '/groups',
      '/invitations',
      '/auth/:path*',
      '/api/:path*',
    ].map((source) => ({
      source,
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Cache-Control', value: 'no-store' },
      ],
    }));
  },
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
};

export default nextConfig;
