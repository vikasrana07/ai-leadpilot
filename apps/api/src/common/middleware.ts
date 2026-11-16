import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppRequest } from './request-context.js';

export const ACCESS_COOKIE = 'lp_at';
export const PLATFORM_COOKIE = 'lp_platform';
export const REFRESH_COOKIE = 'lp_rt';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as AppRequest).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests that carry our auth cookies and no
 * Authorization header must come from the configured web origin. (Cookies are also SameSite=Lax.)
 */
export function csrfOriginMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookies = req.cookies as Record<string, string> | undefined;
    const usesCookies = Boolean(cookies?.[ACCESS_COOKIE] ?? cookies?.[REFRESH_COOKIE] ?? cookies?.[PLATFORM_COOKIE]);
    if (!usesCookies || req.header('authorization')) return next();
    const origin = req.header('origin') ?? safeOrigin(req.header('referer'));
    if (origin && allowed.has(origin)) return next();
    res.status(403).json({ error: { code: 'csrf_blocked', message: 'Cross-origin request blocked', requestId: (req as AppRequest).requestId } });
  };
}

function safeOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try { return new URL(referer).origin; } catch { return undefined; }
}
