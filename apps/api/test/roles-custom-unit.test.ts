import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { RolesController } from '../src/roles/roles.module.js';
import type { TenantRequestContext } from '../src/common/request-context.js';

describe('RolesController - Custom RBAC Role Builder', () => {
  const mockAudit = {
    record: async () => {},
  } as any;

  const mockCtx: TenantRequestContext = {
    tenantId: 'tenant-123',
    userId: 'user-456',
    membershipId: 'mem-789',
    roleKey: 'owner',
    permissions: new Set(['team:read', 'role:manage', 'lead:read:all', 'lead:write:all']),
  } as unknown as TenantRequestContext;

  it('permissions() returns catalogue grouped with category', () => {
    const controller = new RolesController({} as any, mockAudit);
    const perms = controller.permissions();
    expect(perms.length).toBeGreaterThan(10);
    expect(perms.find((p) => p.key === 'lead:read:all')?.category).toBe('lead');
  });

  it('create() rejects reserved system role keys', async () => {
    const controller = new RolesController({} as any, mockAudit);
    await expect(
      controller.create(mockCtx, {
        key: 'owner',
        name: 'Another Owner',
        permissions: ['lead:read:all'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create() rejects unknown permission keys', async () => {
    const controller = new RolesController({} as any, mockAudit);
    await expect(
      controller.create(mockCtx, {
        key: 'custom_role',
        name: 'Custom',
        permissions: ['non_existent:fake_permission'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create() prevents privilege escalation when user lacks permission', async () => {
    const controller = new RolesController({} as any, mockAudit);
    // mockCtx does not have 'billing:manage'
    await expect(
      controller.create(mockCtx, {
        key: 'billing_master',
        name: 'Billing Master',
        permissions: ['billing:manage'],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create() creates role and persists permissions in database', async () => {
    let createdRole: any = null;
    let createdPerms: any = null;

    const mockTx = {
      role: {
        findUnique: async () => null,
        create: async ({ data }: any) => {
          createdRole = data;
          return data;
        },
      },
      rolePermission: {
        createMany: async ({ data }: any) => {
          createdPerms = data;
        },
      },
    };

    const mockDb = {
      tenantTx: async (_ctx: any, fn: any) => fn(mockTx),
    } as any;

    const controller = new RolesController(mockDb, mockAudit);
    const res = await controller.create(mockCtx, {
      key: 'lead_specialist',
      name: 'Lead Specialist',
      permissions: ['lead:read:all', 'lead:write:all'],
    });

    expect(res.key).toBe('lead_specialist');
    expect(res.name).toBe('Lead Specialist');
    expect(res.isSystem).toBe(false);
    expect(createdRole.key).toBe('lead_specialist');
    expect(createdPerms).toHaveLength(2);
  });

  it('update() rejects modifying system roles', async () => {
    const mockTx = {
      role: {
        findFirst: async () => ({
          id: 'system-agent-id',
          key: 'agent',
          isSystem: true,
        }),
      },
    };

    const mockDb = {
      tenantTx: async (_ctx: any, fn: any) => fn(mockTx),
    } as any;

    const controller = new RolesController(mockDb, mockAudit);
    await expect(
      controller.update(mockCtx, 'system-agent-id', {
        name: 'Hacked Agent',
        permissions: ['lead:read:all'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('remove() rejects deleting role currently in use', async () => {
    const mockTx = {
      role: {
        findFirst: async () => ({
          id: 'custom-role-id',
          isSystem: false,
          _count: { memberships: 2, invitations: 0 },
        }),
      },
    };

    const mockDb = {
      tenantTx: async (_ctx: any, fn: any) => fn(mockTx),
    } as any;

    const controller = new RolesController(mockDb, mockAudit);
    await expect(controller.remove(mockCtx, 'custom-role-id')).rejects.toThrow(ConflictException);
  });
});
