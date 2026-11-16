import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { PermissionKey } from '@leadpilot/shared-types';
import type { AppRequest, AuthContext, TenantRequestContext } from './request-context.js';

export const IS_PUBLIC = 'isPublic';
export const NO_TENANT = 'noTenant';
export const PERMISSIONS_META = 'requiredPermissions';

/** Route needs no authentication (auth, if present, is still parsed). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
/** Route needs authentication but not an active workspace (e.g. /auth/me, workspace switching). */
export const NoTenant = (): MethodDecorator & ClassDecorator => SetMetadata(NO_TENANT, true);
/** All listed permissions are required. Enforced server-side by PermissionsGuard. */
export const RequirePermissions = (...keys: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_META, keys);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext | undefined =>
  ctx.switchToHttp().getRequest<AppRequest>().auth);

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantRequestContext => {
  const t = ctx.switchToHttp().getRequest<AppRequest>().tenant;
  if (!t) throw new Error('CurrentTenant used on a route without tenant context');
  return t;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined =>
  ctx.switchToHttp().getRequest<AppRequest>().ip);
