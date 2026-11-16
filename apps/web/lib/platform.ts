import { API_URL, ApiError } from './api';
import type { FeatureKey, LimitKey } from './billing';

interface Envelope { error?: { code?: string; message?: string; details?: { path: string; message: string }[] } }

/** Platform console requests: cookie-authenticated (separate cookie from the tenant app). 401 sends the admin to the console login. */
export async function platformApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/platform${path}`, { method: init.method ?? 'GET', credentials: 'include', headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const env = (json ?? {}) as Envelope;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/') && !window.location.pathname.startsWith('/platform/login')) window.location.assign('/platform/login');
    throw new ApiError(res.status, env.error?.code ?? 'error', env.error?.message ?? 'Request failed', env.error?.details);
  }
  return json as T;
}

export interface PlatformMetrics { tenants: { total: number; suspended: number; new30d: number; byPlan: Record<string, number> }; subscriptions: { trialing: number; active: number; pastDue: number; endedOrExpired: number; complimentary: number }; mrrMinor: number; aiTokensThisMonth: number }
export interface PlatformTenantRow { id: string; name: string; email: string; planKey: string; status: string; createdAt: string; seats: number; leads: number; subscriptionStatus: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; priceMinor: number | null; provider: string | null }
export interface PlatformTenantDetail {
  tenant: { id: string; name: string; email: string; industry: string; planKey: string; status: string; createdAt: string; timezone: string };
  owners: { name: string; email: string }[];
  entitlements: { planKey: string; planName: string; status: string; restricted: boolean; limits: Record<LimitKey, number | null>; features: Record<FeatureKey, boolean> };
  usage: Record<LimitKey, number>;
  subscription: { status: string; provider: string; planKey: string; pendingPlanKey: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; graceEndsAt: string | null; cancelAtPeriodEnd: boolean } | null;
  invoices: { id: string; number: string; totalMinor: number; issuedAt: string }[];
  recentActivity: { action: string; at: string }[];
}
export interface PlatformPlan { key: string; name: string; description: string; priceMinor: number; priceWithGstMinor: number; trialDays: number; isPublic: boolean; active: boolean; sortOrder: number; tenants: number; entitlements: { key: string; enabled: boolean; limit: number | null }[] }
export interface PlatformAuditRow { id: string; action: string; admin: string | null; targetType: string | null; targetId: string | null; tenantId: string | null; reason: string | null; createdAt: string }
