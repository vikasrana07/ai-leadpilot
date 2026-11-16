import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  sessionId: string;
  activeTenantId: string | null;
}

export interface TenantRequestContext {
  /** Derived from the validated membership, never from request input. */
  tenantId: string;
  userId: string;
  membershipId: string;
  roleKey: string;
  permissions: ReadonlySet<string>;
  requestId: string;
  ip: string | undefined;
}

/** Set when the request carries a platform support-access token (read-only, time-limited, audited). */
export interface SupportContext { sessionId: string; adminId: string; adminName: string; reason: string; expiresAt: Date }

export interface ApiKeyContext { id: string; tenantId: string; scopes: readonly string[]; createdBy: string }

export interface AppRequest extends Request {
  /** Set by ApiKeyGuard on public-API (`/v1`) requests. */
  apiKey?: ApiKeyContext;
  support?: SupportContext;
  requestId: string;
  auth?: AuthContext;
  tenant?: TenantRequestContext;
}
