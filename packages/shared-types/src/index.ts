export * from './permissions.js';
export * from './industry-packs.js';
export * from './terms-text.js';
export * from './crm.js';
export * from './email-tracking.js';

export interface WorkspaceSummary {
  tenantId: string;
  name: string;
  roleKey: string;
  roleName: string;
  /** Industry pack the workspace was set up with; decides which optional modules (e.g. Properties) the menu shows. */
  industryPackId: string;
  /** False while the owner has not yet picked an industry in onboarding. */
  industryChosen: boolean;
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
