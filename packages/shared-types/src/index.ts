export * from './permissions.js';

export interface WorkspaceSummary {
  tenantId: string;
  name: string;
  roleKey: string;
  roleName: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface AuthContextResponse {
  user: SessionUser;
  workspaces: WorkspaceSummary[];
  activeTenantId: string | null;
  permissions: string[];
}
