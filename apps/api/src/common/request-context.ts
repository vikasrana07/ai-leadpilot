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

export interface AppRequest extends Request {
  requestId: string;
  auth?: AuthContext;
  tenant?: TenantRequestContext;
}
