import type { TenantRequestContext } from './request-context.js';

/**
 * Who is performing an operation. Human requests map from TenantRequestContext; machine entry points (API-key lead
 * capture, background jobs) build one explicitly with the minimum permissions they need.
 */
export interface Actor {
  tenantId: string;
  userId: string | null;
  membershipId: string | null;
  permissions: ReadonlySet<string>;
  requestId: string | undefined;
  ip: string | undefined;
  /** Set for machine actors, recorded in audit metadata. */
  apiKeyId?: string;
}

export function actorFrom(ctx: TenantRequestContext): Actor {
  return { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, permissions: ctx.permissions, requestId: ctx.requestId, ip: ctx.ip };
}
