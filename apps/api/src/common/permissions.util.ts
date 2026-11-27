/**
 * Computes effective permission keys for a membership by applying per-member
 * GRANT / REVOKE overrides on top of the assigned role's permission keys.
 */
export function resolveEffectivePermissions(
  rolePermissions: readonly string[],
  overrides: readonly { permissionKey: string; effect: 'GRANT' | 'REVOKE' }[],
): Set<string> {
  const effective = new Set(rolePermissions);
  for (const o of overrides) {
    if (o.effect === 'GRANT') effective.add(o.permissionKey);
    else effective.delete(o.permissionKey);
  }
  return effective;
}
