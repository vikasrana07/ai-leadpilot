export * from './permissions.js';
export * from './industry-packs.js';
export * from './crm.js';

export interface WorkspaceSummary {
  tenantId: string;
  name: string;
  roleKey: string;
  roleName: string;
  /** Industry pack the workspace was set up with; decides which optional modules (e.g. Properties) the menu shows. */
  industryPackId: string;
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
