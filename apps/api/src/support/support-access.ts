import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { AuthContextResponse } from '@leadpilot/shared-types';
import type { AppRequest, SupportContext, TenantRequestContext } from '../common/request-context.js';
import type { DbService } from '../db/db.module.js';

/**
 * Support access: a platform admin can look at a workspace, READ ONLY, for a bounded time, with a reason, visibly to the customer.
 * The rules live here in one place and are enforced in the authentication guard, so they apply to every route, including ones that skip tenant checks.
 */
export const SUPPORT_AUDIENCE = 'tenant-support';
export const SUPPORT_MAX_MINUTES = 30;

/** What a support session may read. No team, roles, billing details, credentials, API keys, webhooks, audit logs, knowledge files or exports. */
export const SUPPORT_PERMISSIONS: readonly string[] = ['lead:read:all', 'conversation:read:all', 'appointment:read:all', 'analytics:read:all', 'analytics:read:team', 'analytics:read:own', 'property:read', 'usage:read'];

const SAFE_METHODS = new Set(['GET', 'HEAD']);
/** The only non-GET call a support session may make: ending itself. */
const END_ROUTE = { method: 'POST', path: '/support-session/end' };
/** Allowed even though they sit under blocked prefixes. */
const ALLOWED_EXACT = new Set(['GET /auth/me', 'GET /support-session', 'GET /billing/summary', 'GET /health', 'GET /health/ready']);
/** Prefixes that are blocked outright (secrets, people, money, settings, exfiltration). */
const BLOCKED_PREFIXES = ['/auth', '/api-keys', '/webhooks', '/integrations', '/channels', '/billing', '/privacy', '/team', '/roles', '/audit-logs', '/knowledge', '/ai/assistant', '/ai/runs', '/mfa', '/security', '/notifications', '/realtime', '/platform', '/v1', '/support-access', '/tenant/onboarding', '/exports', '/data-requests'];
/** Anything that downloads or exports data is blocked wherever it lives. */
const BLOCKED_FRAGMENTS = ['/export', '/download', '/media'];

export function supportDecision(method: string, rawPath: string): { allowed: true } | { allowed: false; reason: 'read_only' | 'blocked' } {
  const path = (rawPath.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
  const key = `${method} ${path}`;
  if (method === END_ROUTE.method && path === END_ROUTE.path) return { allowed: true };
  if (!SAFE_METHODS.has(method)) return { allowed: false, reason: 'read_only' };
  if (ALLOWED_EXACT.has(key)) return { allowed: true };
  if (BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) || BLOCKED_FRAGMENTS.some((f) => path.includes(f))) return { allowed: false, reason: 'blocked' };
  return { allowed: true };
}

async function mirrorAudit(db: DbService, s: SupportContext, tenantId: string, action: string, method: string, path: string, ip: string | undefined): Promise<void> {
  // Both sides of the trail, best effort per row but never skipped silently: tenant owners see it under Audit, the platform keeps its own copy.
  const p = path.split('?')[0] ?? path;
  await db.tenantTx({ tenantId }, (tx) => tx.auditLog.createMany({ data: [{ tenantId, actorUserId: null, action, resourceType: 'support_session', resourceId: s.sessionId, metadata: { adminId: s.adminId, adminName: s.adminName, method, path: p }, ip: ip ?? null }] }));
  await db.prisma.platformAuditLog.createMany({ data: [{ adminId: s.adminId, action: action.replace('support.', 'platform.support_'), targetType: 'support_session', targetId: s.sessionId, tenantId, metadata: { method, path: p }, ip: ip ?? null }] });
}

/**
 * Called by AuthGuard when the bearer/cookie token is a support token. Validates the session (unexpired, not ended, tenant active, owner has not
 * switched support access off), applies the read-only and blocklist rules to this very request, audits it, and fills `req.auth` / `req.support`.
 */
export async function authenticateSupport(db: DbService, req: AppRequest, claims: { adminId: string; sessionId: string; tenantId: string }): Promise<void> {
  const rows = await db.prisma.$queryRaw<{ admin_id: string; admin_name: string; reason: string; expires_at: Date }[]>`SELECT * FROM support_session_active(${claims.sessionId}::uuid, ${claims.tenantId}::uuid)`;
  const s = rows[0];
  if (!s || s.admin_id !== claims.adminId) throw new UnauthorizedException({ code: 'support_session_ended', message: 'This support session has ended' });
  const ctx: SupportContext = { sessionId: claims.sessionId, adminId: s.admin_id, adminName: s.admin_name, reason: s.reason, expiresAt: s.expires_at };
  const d = supportDecision(req.method, req.originalUrl);
  if (!d.allowed) {
    // The live-update stream retries on its own; auditing every refused reconnect would only bury the real trail.
    if (!req.originalUrl.startsWith('/realtime')) await mirrorAudit(db, ctx, claims.tenantId, 'support.blocked', req.method, req.originalUrl, req.ip);
    throw new ForbiddenException(d.reason === 'read_only'
      ? { code: 'support_session_read_only', message: 'Support sessions are read-only. This action was not performed.' }
      : { code: 'blocked_for_support', message: 'This area is not available to support sessions.' });
  }
  // Housekeeping calls (who am I, end session) are not content access; every other allowed request is mirrored to both audit trails.
  if (!req.originalUrl.startsWith('/support-session')) await mirrorAudit(db, ctx, claims.tenantId, 'support.request', req.method, req.originalUrl, req.ip);
  req.auth = { userId: claims.adminId, sessionId: claims.sessionId, activeTenantId: claims.tenantId };
  req.support = ctx;
}

/** The synthetic, read-only member a support session acts as inside the workspace. Its "user" is the admin id, which belongs to no workspace row. */
export function supportTenantContext(req: AppRequest): TenantRequestContext {
  const s = req.support;
  const a = req.auth;
  if (!s || !a?.activeTenantId) throw new UnauthorizedException({ code: 'unauthenticated', message: 'Authentication required' });
  return { tenantId: a.activeTenantId, userId: s.adminId, membershipId: '', roleKey: 'support', permissions: new Set(SUPPORT_PERMISSIONS), requestId: req.requestId, ip: req.ip };
}

export function supportMe(req: AppRequest, tenant: { name: string; industryPackId: string }): AuthContextResponse {
  const s = req.support;
  if (!s || !req.auth?.activeTenantId) throw new UnauthorizedException({ code: 'unauthenticated', message: 'Authentication required' });
  return {
    user: { id: s.adminId, email: 'support@leadpilot.invalid', name: `${s.adminName} (LeadPilot support)`, emailVerified: true },
    workspaces: [{ tenantId: req.auth.activeTenantId, name: tenant.name, roleKey: 'support', roleName: 'Support (read-only)', industryPackId: tenant.industryPackId }],
    activeTenantId: req.auth.activeTenantId, permissions: [...SUPPORT_PERMISSIONS],
  };
}
