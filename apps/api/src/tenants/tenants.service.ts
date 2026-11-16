import { Inject, Injectable } from '@nestjs/common';
import type { TxClient } from '@leadpilot/database';
import { SYSTEM_ROLES, type SystemRoleKey } from '@leadpilot/shared-types';
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
    await tx.tenant.create({
      data: { id: tenantId, name: input.name, email: input.email, industry: input.industry, onboardingState: { step: 'business', completed: [], skipped: [] } },
    });
    let ownerRoleId = '';
    for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
      const def = SYSTEM_ROLES[key];
      const roleId = uuidv7();
      if (key === 'owner') ownerRoleId = roleId;
      await tx.role.create({ data: { id: roleId, tenantId, key, name: def.name, isSystem: true } });
      await tx.rolePermission.createMany({ data: def.permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })) });
    }
    return { ownerRoleId };
  }

  get(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }));
  }

  update(ctx: TenantRequestContext, input: UpdateTenantInput) {
    return this.db.tenantTx(ctx, async (tx) => {
      const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const updated = await tx.tenant.update({ where: { id: ctx.tenantId }, data });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'tenant.updated', resourceType: 'tenant',
        resourceId: ctx.tenantId, metadata: { fields: Object.keys(data) }, requestId: ctx.requestId, ip: ctx.ip,
      });
      return updated;
    });
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
