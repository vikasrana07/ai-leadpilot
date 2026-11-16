import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = (() => { try { return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin; } catch { return 'http://localhost:4000'; } })();

/**
 * Content-Security-Policy for the app. Next injects inline bootstrap scripts, so `script-src` needs 'unsafe-inline' (a nonce-based
 * policy needs dynamic rendering for every page: a later hardening step). The rest is tight: no framing, no foreign form targets,
 * connections only to our API (+ Razorpay), no plugins. 'unsafe-eval' is development-only (React refresh).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} https://api.razorpay.com https://lumberjack.razorpay.com${isDev ? ' ws: wss:' : ''}`,
  'frame-src https://api.razorpay.com https://checkout.razorpay.com',
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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
        { key: 'Content-Security-Policy', value: csp },
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
