import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PERMISSIONS, isPermissionKey, type PermissionKey } from '@leadpilot/shared-types';
import {
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@leadpilot/validation';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { AuditService } from '../audit/audit.service.js';

@Controller('roles')
export class RolesController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('team:read')
  async list(@CurrentTenant() ctx: TenantRequestContext) {
    const roles = await this.db.tenantTx(ctx, (tx) =>
      tx.role.findMany({
        where: { tenantId: ctx.tenantId },
        include: {
          permissions: true,
          _count: { select: { memberships: true, invitations: true } },
        },
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      }),
    );
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      isSystem: r.isSystem,
      memberCount: r._count.memberships + r._count.invitations,
      permissions: r.permissions
        .map((p) => p.permissionKey)
        .filter(isPermissionKey)
        .map((key) => ({ key, description: PERMISSIONS[key] })),
    }));
  }

  @Get('permissions')
  @RequirePermissions('team:read')
  permissions() {
    return Object.entries(PERMISSIONS).map(([key, description]) => {
      const [category = 'other', action = ''] = key.split(':');
      return {
        key,
        description,
        category,
        action,
      };
    });
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('role:manage')
  async create(
    @CurrentTenant() ctx: TenantRequestContext,
    @Body(new ZodPipe(createRoleSchema)) body: CreateRoleInput,
  ) {
    // 1. System role key collision check
    if (['owner', 'manager', 'agent'].includes(body.key)) {
      throw new BadRequestException({
        code: 'reserved_role_key',
        message: 'The role keys "owner", "manager", and "agent" are reserved for system roles',
      });
    }

    // 2. Validate all permission keys
    const invalid = body.permissions.filter((p) => !isPermissionKey(p));
    if (invalid.length > 0) {
      throw new BadRequestException({
        code: 'invalid_permissions',
        message: `Unknown permission key(s): ${invalid.join(', ')}`,
      });
    }

    // 3. Privilege escalation guard: cannot grant permissions you don't hold
    const missing = body.permissions.some((p) => !ctx.permissions.has(p as PermissionKey));
    if (missing) {
      throw new ForbiddenException({
        code: 'cannot_grant_permissions',
        message: 'You cannot grant permissions that you do not hold',
      });
    }

    return this.db.tenantTx(ctx, async (tx) => {
      // Check existing key in tenant
      const existing = await tx.role.findUnique({
        where: { tenantId_key: { tenantId: ctx.tenantId, key: body.key } },
      });
      if (existing) {
        throw new ConflictException({
          code: 'role_exists',
          message: `A role with key "${body.key}" already exists in this workspace`,
        });
      }

      const roleId = uuidv7();
      const role = await tx.role.create({
        data: {
          id: roleId,
          tenantId: ctx.tenantId,
          key: body.key,
          name: body.name,
          isSystem: false,
        },
      });

      if (body.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: body.permissions.map((permissionKey) => ({
            tenantId: ctx.tenantId,
            roleId,
            permissionKey,
          })),
        });
      }

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'role.created',
        resourceType: 'role',
        resourceId: roleId,
        metadata: { key: body.key, name: body.name, permissionsCount: body.permissions.length },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      return {
        id: role.id,
        key: role.key,
        name: role.name,
        isSystem: false,
        memberCount: 0,
        permissions: body.permissions.map((key) => ({
          key,
          description: PERMISSIONS[key as PermissionKey],
        })),
      };
    });
  }

  @Patch(':id')
  @RequirePermissions('role:manage')
  async update(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(updateRoleSchema)) body: UpdateRoleInput,
  ) {
    // 1. Validate all permission keys
    const invalid = body.permissions.filter((p) => !isPermissionKey(p));
    if (invalid.length > 0) {
      throw new BadRequestException({
        code: 'invalid_permissions',
        message: `Unknown permission key(s): ${invalid.join(', ')}`,
      });
    }

    // 2. Privilege escalation guard: cannot grant permissions you don't hold
    const missing = body.permissions.some((p) => !ctx.permissions.has(p as PermissionKey));
    if (missing) {
      throw new ForbiddenException({
        code: 'cannot_grant_permissions',
        message: 'You cannot grant permissions that you do not hold',
      });
    }

    return this.db.tenantTx(ctx, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, tenantId: ctx.tenantId },
        include: { permissions: true },
      });

      if (!role) {
        throw new NotFoundException({ code: 'role_not_found', message: 'Role not found' });
      }

      if (role.isSystem) {
        throw new BadRequestException({
          code: 'system_role',
          message: 'System roles cannot be modified',
        });
      }

      // Update role name
      await tx.role.update({
        where: { id },
        data: { name: body.name },
      });

      // Synchronize permissions: delete existing and recreate
      await tx.rolePermission.deleteMany({
        where: { roleId: id },
      });

      await tx.rolePermission.createMany({
        data: body.permissions.map((permissionKey) => ({
          tenantId: ctx.tenantId,
          roleId: id,
          permissionKey,
        })),
      });

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'role.updated',
        resourceType: 'role',
        resourceId: id,
        metadata: { name: body.name, permissionsCount: body.permissions.length },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      return {
        id: role.id,
        key: role.key,
        name: body.name,
        isSystem: false,
        permissions: body.permissions.map((key) => ({
          key,
          description: PERMISSIONS[key as PermissionKey],
        })),
      };
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('role:manage')
  async remove(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.db.tenantTx(ctx, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, tenantId: ctx.tenantId },
        include: {
          _count: { select: { memberships: true, invitations: true } },
        },
      });

      if (!role) {
        throw new NotFoundException({ code: 'role_not_found', message: 'Role not found' });
      }

      if (role.isSystem) {
        throw new BadRequestException({
          code: 'system_role',
          message: 'System roles cannot be deleted',
        });
      }

      if (role._count.memberships > 0 || role._count.invitations > 0) {
        throw new ConflictException({
          code: 'role_in_use',
          message: `This role is currently assigned to ${role._count.memberships} member(s) and ${role._count.invitations} pending invitation(s). Reassign them first.`,
        });
      }

      await tx.role.delete({ where: { id } });

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'role.deleted',
        resourceType: 'role',
        resourceId: id,
        metadata: { key: role.key, name: role.name },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });
    });
  }
}

@Module({
  controllers: [RolesController],
})
export class RolesModule {}
