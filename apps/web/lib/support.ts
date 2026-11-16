import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SupportSession { active: boolean; adminName?: string; reason?: string; expiresAt?: string }

/** The current LeadPilot support session (read-only staff access), shared by the banner and the navigation. */
export function useSupportSession() {
  return useQuery({ queryKey: ['support-session'], queryFn: () => api<SupportSession>('/support-session'), refetchInterval: 30_000, retry: false });
}

/** Areas the API refuses outright during a support session (credentials, billing details, team/roles, API keys, webhooks, privacy, MFA, settings). Hidden rather than shown as errors. */
export const BLOCKED_DURING_SUPPORT = new Set(['/team', '/roles', '/integrations', '/api-keys', '/webhooks', '/billing', '/security', '/settings']);
