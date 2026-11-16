import { SetMetadata } from '@nestjs/common';
import type { ApiScope } from '@leadpilot/validation';

export const REQUIRE_SCOPE = 'requireScope';
/** Public-API route needs this API-key scope (enforced by ApiKeyGuard; keys never carry roles, only scopes). */
export const RequireScope = (scope: ApiScope): MethodDecorator => SetMetadata(REQUIRE_SCOPE, scope);

/** Scope -> internal permissions. A key can never exceed what its scopes grant, and never gets team, billing, integration or admin rights. */
export const SCOPE_PERMISSIONS: Record<ApiScope, readonly string[]> = {
  'leads:create': ['lead:write:all'],
  'leads:read': ['lead:read:all'],
  'leads:write': ['lead:read:all', 'lead:write:all', 'lead:assign'],
  'leads:delete': ['lead:read:all', 'lead:delete'],
  'conversations:read': ['conversation:read:all', 'lead:read:all'],
  'appointments:read': ['appointment:read:all', 'lead:read:all'],
  'appointments:write': ['appointment:read:all', 'appointment:write', 'lead:read:all', 'lead:write:all'],
};
