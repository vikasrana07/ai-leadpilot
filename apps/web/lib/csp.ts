/**
 * Strict Nonce-based Content Security Policy (CSP) generator for Next.js.
 * Injects cryptographic nonces for script execution and removes 'unsafe-inline' from script-src.
 */

export interface CspOptions {
  nonce: string;
  isDev?: boolean;
  apiOrigin?: string;
}

export function generateNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    const raw = crypto.randomUUID().replace(/-/g, '');
    return Buffer.from(raw, 'hex').toString('base64');
  }
  // Fallback for edge runtime where crypto.getRandomValues is standard
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}

export function buildCsp({ nonce, isDev = false, apiOrigin = 'http://localhost:4000' }: CspOptions): string {
  // In development, Next.js Fast Refresh requires 'unsafe-eval'.
  // In production, 'strict-dynamic' trusts scripts loaded by nonced scripts while strictly rejecting un-nonced inline scripts.
  const scriptDirectives = [
    "'self'",
    `'nonce-${nonce}'`,
    isDev ? "'unsafe-eval'" : "'strict-dynamic'",
    'https://checkout.razorpay.com',
    'https://challenges.cloudflare.com',
    'https://connect.facebook.net',
  ].join(' ');

  const connectDirectives = [
    "'self'",
    'https://api.razorpay.com',
    'wss:',
    apiOrigin,
    'https://lumberjack.razorpay.com',
    'https://graph.facebook.com',
    'https://www.facebook.com',
    'https://web.facebook.com',
    ...(isDev ? ['ws:'] : []),
  ].join(' ');

  const directives = [
    "default-src 'self'",
    `script-src ${scriptDirectives}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectDirectives}`,
    'frame-src https://api.razorpay.com https://checkout.razorpay.com https://challenges.cloudflare.com https://www.facebook.com https://web.facebook.com',
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return directives.join('; ');
}
