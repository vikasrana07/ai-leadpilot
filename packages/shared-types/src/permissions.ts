/**
 * Permission catalogue. Keys are `resource:action[:scope]`. `own` = restricted to records assigned to the user,
 * `all` = any record in the tenant. Backend guards are the only enforcement point; the UI only mirrors them.
 */
export const PERMISSIONS = {
  // Leads
  'lead:read:own': 'View leads assigned to me',
  'lead:read:all': 'View all leads in the workspace',
  'lead:write:own': 'Edit leads assigned to me',
  'lead:write:all': 'Create and edit any lead',
  'lead:delete': 'Delete leads',
  'lead:assign': 'Assign leads to team members',
  'lead:import': 'Import leads from CSV',
  'lead:export': 'Export leads to CSV',
  'lead:score:override': 'Override lead scores',
  // Pipeline
  'pipeline:manage': 'Configure pipeline stages',
  // Conversations
  'conversation:read:own': 'View my conversations',
  'conversation:read:all': 'View all conversations',
  'conversation:reply': 'Reply in conversations',
  'conversation:assign': 'Assign conversations',
  // Appointments
  'appointment:read:own': 'View my appointments',
  'appointment:read:all': 'View all appointments',
  'appointment:write': 'Create and change appointments',
  // AI & knowledge
  'ai:configure': 'Configure the AI assistant',
  'knowledge:manage': 'Manage knowledge base documents',
  // Automations
  'automation:manage': 'Manage automations',
  // Analytics
  'analytics:read:own': 'View my performance',
  'analytics:read:team': 'View team analytics',
  'analytics:read:all': 'View all analytics and reports',
  // Admin
  'team:read': 'View team members',
  'team:invite': 'Invite team members',
  'team:manage': 'Change roles, deactivate and remove members',
  'role:manage': 'Manage roles and permissions',
  'integration:manage': 'Manage integrations',
  'billing:manage': 'Manage subscription and billing',
  'usage:read': 'View usage',
  'audit:read': 'View audit logs',
  'settings:manage': 'Manage workspace settings',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export type SystemRoleKey = 'owner' | 'manager' | 'agent';

const AGENT: PermissionKey[] = [
  'lead:read:own', 'lead:write:own', 'conversation:read:own', 'conversation:reply',
  'appointment:read:own', 'appointment:write', 'analytics:read:own', 'team:read',
];

const MANAGER: PermissionKey[] = [
  ...AGENT,
  'lead:read:all', 'lead:write:all', 'lead:assign', 'lead:import', 'lead:export', 'lead:score:override',
  'pipeline:manage', 'conversation:read:all', 'conversation:assign', 'appointment:read:all',
  'analytics:read:team', 'analytics:read:all', 'usage:read', 'automation:manage',
];

export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; permissions: readonly PermissionKey[] }> = {
  owner: { name: 'Business Owner', permissions: ALL_PERMISSION_KEYS },
  manager: { name: 'Sales Manager', permissions: [...new Set<PermissionKey>([...MANAGER, 'team:invite'])] },
  agent: { name: 'Sales Agent', permissions: [...new Set(AGENT)] },
};

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
