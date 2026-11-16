import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { PLATFORM_COOKIE } from '../common/middleware.js';
import type { AppRequest } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';

/** Different audience and secret from tenant tokens: a tenant token can never open the console and vice versa (ADR-0003). */
const AUDIENCE = 'platform-console';
const ISSUER = 'leadpilot';
export const PLATFORM_TTL_SECONDS = 30 * 60;

export interface PlatformAdminCtx { id: string; email: string; name: string }
export interface PlatformRequest extends AppRequest { platformAdmin?: PlatformAdminCtx }

@Injectable()
export class PlatformTokens {
  private readonly key: Uint8Array | null;
  constructor(@Inject(ENV) env: Env) { this.key = env.PLATFORM_JWT_SECRET ? new TextEncoder().encode(env.PLATFORM_JWT_SECRET) : null; }
  get enabled(): boolean { return this.key !== null; }
  async sign(adminId: string): Promise<string> {
    if (!this.key) throw new Error('platform console disabled');
    return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(adminId).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(`${PLATFORM_TTL_SECONDS}s`).sign(this.key);
  }
  async verify(token: string): Promise<string | null> {
    if (!this.key) return null;
    try { const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] }); return typeof payload.sub === 'string' ? payload.sub : null; } catch { return null; }
  }
}

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(@Inject(PlatformTokens) private readonly tokens: PlatformTokens, @Inject(DbService) private readonly db: DbService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PlatformRequest>();
    const h = req.header('authorization');
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = h?.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : cookies?.[PLATFORM_COOKIE];
    const id = token ? await this.tokens.verify(token) : null;
    // Every call re-checks the admin row, so disabling an admin takes effect immediately. Same error for every failure.
    const admin = id ? await this.db.prisma.platformAdmin.findUnique({ where: { id }, select: { id: true, email: true, name: true, status: true } }) : null;
    if (!admin || admin.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'unauthenticated', message: 'Platform sign-in required' });
    req.platformAdmin = { id: admin.id, email: admin.email, name: admin.name };
    return true;
  }
}
