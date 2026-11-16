import { type CanActivate, type ExecutionContext, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';
import { API_SCOPES, type ApiScope } from '@leadpilot/validation';
import { hashToken } from '../auth/crypto.js';
import { EntitlementsService, paymentRequired } from '../billing/entitlements.service.js';
import { RedisThrottlerStorage } from '../common/redis-throttler.js';
import type { AppRequest } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { REQUIRE_SCOPE } from './v1-meta.js';

export const KEY_PREFIX = 'lp_live_';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const invalid = () => new UnauthorizedException({ code: 'invalid_api_key', message: 'Invalid or expired API key' });

/**
 * Authenticates public-API requests: `Authorization: Bearer lp_live_...`. The tenant comes from the key (never from input), the key must be
 * unrevoked, unexpired and carry the route's scope, the tenant's plan must include API access, and each key is rate limited on its own.
 * Session JWTs are not accepted here, and API keys are not accepted by the tenant guards.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly limiter: ThrottlerStorage;
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector, @Inject(DbService) private readonly db: DbService,
    @Inject(EntitlementsService) private readonly ent: EntitlementsService, @Inject(ENV) private readonly env: Env,
  ) {
    // Redis-backed so the limit holds across API instances; in-memory in tests (counters would leak between runs) and when Redis is down.
    this.limiter = env.NODE_ENV === 'test' ? new ThrottlerStorageService() : new RedisThrottlerStorage(env.REDIS_URL, `${env.QUEUE_PREFIX}:apikey`);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const h = req.header('authorization');
    const raw = h?.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : undefined;
    if (!raw || !raw.startsWith(KEY_PREFIX) || raw.length > 100) throw invalid();

    const found = await this.db.userTx(null, (tx) => tx.$queryRaw<{ id: string; tenant_id: string; scopes: string[]; revoked_at: Date | null; expires_at: Date | null }[]>`SELECT * FROM find_api_key_by_hash(${hashToken(raw)})`);
    const key = found[0];
    if (!key || key.revoked_at || (key.expires_at && key.expires_at <= new Date())) throw invalid();

    const plan = await this.ent.get(key.tenant_id);
    if (!plan.features.api_access) throw paymentRequired('feature_not_in_plan', `The public API is not included in your ${plan.planName} plan. Upgrade to use it.`, { feature: 'api_access', plan: plan.planKey });
    if (plan.restricted && !SAFE.has(req.method)) throw paymentRequired('subscription_required', 'This workspace is read-only until a plan is active.', { plan: plan.planKey });

    const limit = this.env.API_KEY_RATE_LIMIT_PER_MIN;
    const hit = await this.limiter.increment(`key:${key.id}`, 60_000, limit, 0, 'apikey');
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - hit.totalHits)));
    if (hit.totalHits > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(hit.timeToExpire / 1000))));
      throw new HttpException({ code: 'rate_limited', message: `Rate limit of ${limit} requests per minute exceeded for this API key` }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const scope = this.reflector.get<ApiScope | undefined>(REQUIRE_SCOPE, ctx.getHandler());
    if (scope && (!API_SCOPES.includes(scope) || !key.scopes.includes(scope))) throw new ForbiddenException({ code: 'insufficient_scope', message: `This API key lacks the required scope: ${scope}` });

    const row = await this.db.tenantTx({ tenantId: key.tenant_id }, (tx) => tx.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), requestCount: { increment: 1 } }, select: { createdBy: true } }));
    req.apiKey = { id: key.id, tenantId: key.tenant_id, scopes: key.scopes, createdBy: row.createdBy };
    return true;
  }
}
