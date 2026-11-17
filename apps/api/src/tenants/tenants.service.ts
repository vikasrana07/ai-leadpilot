import { Inject, Injectable } from '@nestjs/common';
import { bootstrapTenant, switchIndustryPack, type TxClient } from '@leadpilot/database';
import type { OnboardingProgress, UpdateTenantInput } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { DbService } from '../db/db.module.js';

@Injectable()
export class TenantsService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * Creates a tenant with its system roles inside an already tenant-scoped transaction
   * (the caller must have set app.tenant_id = tenantId). Returns the owner role id.
   */
  async bootstrap(
    tx: TxClient,
    tenantId: string,
    input: { name: string; email: string; industry: string },
  ): Promise<{ ownerRoleId: string }> {
    const { ownerRoleId } = await bootstrapTenant(tx, tenantId, { ...input, newId: uuidv7 });
    return { ownerRoleId };
  }

  get(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }));
  }

  update(ctx: TenantRequestContext, input: UpdateTenantInput) {
    return this.db.tenantTx(ctx, async (tx) => {
      const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const updated = await tx.tenant.update({ where: { id: ctx.tenantId }, data });
      // Picking a different industry before any lead exists re-seeds the pipeline, lost reasons and fields for it.
      const switched = typeof input.industry === 'string' ? await switchIndustryPack(tx, ctx.tenantId, input.industry, uuidv7) : false;
      await this.audit.record(tx, {
        tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'tenant.updated', resourceType: 'tenant',
        resourceId: ctx.tenantId, metadata: { fields: Object.keys(data), ...(switched ? { industryPackSwitched: true } : {}) }, requestId: ctx.requestId, ip: ctx.ip,
      });
      return switched ? tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }) : updated;
    });
  }

  /** Lead assignment strategy. Switching to round robin resets the rotation cursor. */
  setAssignment(ctx: TenantRequestContext, strategy: 'manual' | 'round_robin') {
    return this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
      const settings = (t.settings ?? {}) as Record<string, unknown>;
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...settings, assignment: { strategy, cursor: null } } } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'tenant.assignment_changed', resourceType: 'tenant', resourceId: ctx.tenantId, metadata: { strategy }, requestId: ctx.requestId, ip: ctx.ip });
      return { strategy };
    });
  }

  async getAssignment(ctx: TenantRequestContext): Promise<{ strategy: 'manual' | 'round_robin' }> {
    const t = await this.db.tenantTx(ctx, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } }));
    const a = (t.settings as { assignment?: { strategy?: string } } | null)?.assignment;
    return { strategy: a?.strategy === 'round_robin' ? 'round_robin' : 'manual' };
  }

  async getOnboarding(ctx: TenantRequestContext): Promise<unknown> {
    const t = await this.db.tenantTx(ctx, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { onboardingState: true } }));
    return t.onboardingState;
  }

  saveOnboarding(ctx: TenantRequestContext, progress: OnboardingProgress): Promise<OnboardingProgress> {
    return this.db.tenantTx(ctx, async (tx) => {
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { onboardingState: progress } });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'onboarding.updated', resourceType: 'tenant',
        resourceId: ctx.tenantId, metadata: { step: progress.step }, requestId: ctx.requestId, ip: ctx.ip,
      });
      return progress;
    });
  }
}
