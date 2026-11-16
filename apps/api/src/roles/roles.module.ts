import { Controller, Get, Inject, Module } from '@nestjs/common';
import { PERMISSIONS, isPermissionKey } from '@leadpilot/shared-types';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { DbService } from '../db/db.module.js';

@Controller('roles')
class RolesController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get()
  @RequirePermissions('team:read')
  async list(@CurrentTenant() ctx: TenantRequestContext) {
    const roles = await this.db.tenantTx(ctx, (tx) =>
      tx.role.findMany({ where: { tenantId: ctx.tenantId }, include: { permissions: true }, orderBy: { createdAt: 'asc' } }),
    );
    return roles.map((r) => ({
      id: r.id, key: r.key, name: r.name, isSystem: r.isSystem,
      permissions: r.permissions.map((p) => p.permissionKey).filter(isPermissionKey).map((key) => ({ key, description: PERMISSIONS[key] })),
    }));
  }
}

@Module({ controllers: [RolesController] })
export class RolesModule {}
