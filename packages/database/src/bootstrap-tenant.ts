import { randomUUID } from 'node:crypto';
import { SYSTEM_ROLES, type SystemRoleKey } from '@leadpilot/shared-types';
import type { TxClient } from './index.js';
import { applyIndustryPack } from './industry-pack.js';

/**
 * Creates a tenant with its three system roles and their permissions. Must run inside a transaction where
 * `app.tenant_id` = tenantId (RLS WITH CHECK requires it). Shared by registration and the seed script.
 */
export async function bootstrapTenant(
  tx: TxClient,
  tenantId: string,
  input: { name: string; email: string; industry: string; newId?: () => string },
): Promise<{ ownerRoleId: string; roleIds: Record<SystemRoleKey, string> }> {
  const newId = input.newId ?? randomUUID;
  await tx.tenant.create({
    data: { id: tenantId, name: input.name, email: input.email, industry: input.industry, onboardingState: { step: 'business', completed: [], skipped: [] } },
  });
  const roleIds = {} as Record<SystemRoleKey, string>;
  for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
    const def = SYSTEM_ROLES[key];
    const roleId = newId();
    roleIds[key] = roleId;
    await tx.role.create({ data: { id: roleId, tenantId, key, name: def.name, isSystem: true } });
    await tx.rolePermission.createMany({ data: def.permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })) });
  }
  await applyIndustryPack(tx, tenantId, input.industry, newId);
  return { ownerRoleId: roleIds.owner, roleIds };
}
