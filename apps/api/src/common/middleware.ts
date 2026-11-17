import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { metrics } from '../observability/metrics.js';
import { runWithLogContext } from '../observability/request-context.js';
import type { AppRequest } from './request-context.js';

export const ACCESS_COOKIE = 'lp_at';
export const PLATFORM_COOKIE = 'lp_platform';
export const REFRESH_COOKIE = 'lp_rt';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as AppRequest).requestId = id;
  res.setHeader('x-request-id', id);
  // Everything this request does (guards, services, logs) runs inside this context, so log lines carry the request id.
  runWithLogContext({ requestId: id }, () => next());
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

/**
 * One structured JSON line per request (stdout), so latency, error rate and per-tenant traffic can be measured from logs without extra
 * infrastructure. Carries requestId, tenantId and userId when known. Uses the route PATTERN (never raw ids, query strings or bodies),
 * so no personal data or tokens reach the logs. Health probes are skipped.
 */
export function accessLogMiddleware(enabled: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled || req.path.startsWith('/health')) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const r = req as AppRequest;
      const route = (r.route as { path?: string } | undefined)?.path;
      process.stdout.write(`${JSON.stringify({
        ts: new Date().toISOString(), level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', msg: 'request',
        requestId: r.requestId, method: req.method, route: route ? `${req.baseUrl}${route}` : 'unmatched', status: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10,
        ...(r.tenant?.tenantId ? { tenantId: r.tenant.tenantId } : {}), ...(r.auth?.userId ? { userId: r.auth.userId } : {}),
      })}\n`);
    });
    next();
  };
}

/**
 * Records request count and duration in the in-process metrics (status class and a coarse route group only: never a path, id or tenant).
 * Independent of ACCESS_LOG. Health probes are skipped, like the access log.
 */
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/health')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = (req.route as { path?: string } | undefined)?.path;
    metrics.http(res.statusCode, route ? `${req.baseUrl}${route}` : '', Number(process.hrtime.bigint() - start) / 1e6);
  });
  next();
}
