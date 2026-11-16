import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@leadpilot/validation';
import { BILLING_EXEMPT, REQUIRE_FEATURE } from '../common/billing-meta.js';
import type { AppRequest } from '../common/request-context.js';
import { EntitlementsService, paymentRequired } from './entitlements.service.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Runs after tenant resolution. A lapsed workspace becomes read-only (402 on writes); plan features are enforced per route. */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(EntitlementsService) private readonly ent: EntitlementsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.tenant) return true; // public / no-tenant routes
    const targets = [ctx.getHandler(), ctx.getClass()];
    const exempt = this.reflector.getAllAndOverride<boolean>(BILLING_EXEMPT, targets);
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(REQUIRE_FEATURE, targets);
    if (exempt && !feature) return true;
    const e = await this.ent.get(req.tenant.tenantId);
    if (e.pendingDeletionAt && !exempt && !SAFE.has(req.method)) {
      throw new HttpException({ code: 'pending_deletion', message: 'This workspace is scheduled for deletion and is read-only. The owner can cancel the deletion in Settings.', details: { purgeAfter: e.pendingDeletionAt } }, HttpStatus.FORBIDDEN);
    }
    if (e.restricted && !exempt && !SAFE.has(req.method)) {
      throw paymentRequired('subscription_required', e.status === 'EXPIRED' && e.trialEndsAt && !e.currentPeriodEnd ? 'Your free trial has ended. Choose a plan to keep making changes.' : 'Your subscription is not active. Renew or choose a plan to keep making changes.', { plan: e.planKey });
    }
    if (feature && !e.features[feature]) throw paymentRequired('feature_not_in_plan', `This feature is not included in your ${e.planName} plan. Upgrade to use it.`, { feature, plan: e.planKey });
    return true;
  }
}
