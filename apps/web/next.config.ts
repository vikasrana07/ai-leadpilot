import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@leadpilot/validation', '@leadpilot/shared-types'],
};

export default config;
