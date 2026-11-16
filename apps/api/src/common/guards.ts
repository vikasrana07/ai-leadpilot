import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@leadpilot/shared-types';
import { ACCESS_COOKIE } from './middleware.js';
import { IS_PUBLIC, NO_TENANT, PERMISSIONS_META } from './decorators.js';
import type { AppRequest } from './request-context.js';
import { TokenService } from '../auth/token.service.js';
import { DbService } from '../db/db.module.js';

function extractToken(req: AppRequest): string | undefined {
  const h = req.header('authorization');
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[ACCESS_COOKIE];
}

/** Authenticates the caller. On @Public routes a valid token is still parsed (optional auth) but never required. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DbService) private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = extractToken(req);
    const claims = token ? await this.tokens.verifyAccess(token) : null;

    if (claims) {
      // A revoked/expired session or disabled user invalidates the access token immediately.
      const session = await this.db.prisma.session.findUnique({
        where: { id: claims.sessionId },
        select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true } } },
      });
      const valid = session && session.userId === claims.userId && !session.revokedAt && session.expiresAt > new Date() && session.user.status === 'ACTIVE';
      if (valid) req.auth = { userId: claims.userId, sessionId: claims.sessionId, activeTenantId: claims.tenantId };
    }
    if (isPublic) return true;
    if (!req.auth) throw new UnauthorizedException({ code: 'unauthenticated', message: 'Authentication required' });
    return true;
  }
}

/** Resolves tenant context from the authenticated user's validated membership. Never trusts client-supplied tenant ids. */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(DbService) private readonly db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]) ||
      this.reflector.getAllAndOverride<boolean>(NO_TENANT, [ctx.getHandler(), ctx.getClass()]);
    if (skip) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException({ code: 'unauthenticated', message: 'Authentication required' });
    if (!auth.activeTenantId) throw new ForbiddenException({ code: 'no_workspace', message: 'No active workspace selected' });

    const membership = await this.db.tenantTx({ tenantId: auth.activeTenantId, userId: auth.userId }, (tx) =>
      tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: auth.activeTenantId as string, userId: auth.userId } },
        select: {
          id: true, status: true,
          tenant: { select: { status: true } },
          role: { select: { key: true, permissions: { select: { permissionKey: true } } } },
        },
      }),
    );
    // Same error for "not a member", "deactivated" and "tenant suspended": do not reveal which.
    if (!membership || membership.status !== 'ACTIVE' || membership.tenant.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'workspace_access_denied', message: 'You do not have access to this workspace' });
    }
    req.tenant = {
      tenantId: auth.activeTenantId,
      userId: auth.userId,
      membershipId: membership.id,
      roleKey: membership.role.key,
      permissions: new Set(membership.role.permissions.map((p) => p.permissionKey)),
      requestId: req.requestId,
      ip: req.ip,
    };
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_META, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    const t = ctx.switchToHttp().getRequest<AppRequest>().tenant;
    if (!t || !required.every((k) => t.permissions.has(k))) {
      throw new ForbiddenException({ code: 'forbidden', message: 'You do not have permission to do this' });
    }
    return true;
  }
}
