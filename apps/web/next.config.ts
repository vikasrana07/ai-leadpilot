import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = (() => { try { return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin; } catch { return 'http://localhost:4000'; } })();

/**
 * Security headers for the app. Content-Security-Policy is dynamically generated with
 * cryptographic nonces per-request in `middleware.ts`.
 */
const config: NextConfig = {
  // E2E builds into a separate dir (inside node_modules, which every tool already ignores) so they never clobber the dev `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@leadpilot/validation', '@leadpilot/shared-types'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
      ],
    }];
  },
};

export default config;
