import type { AuthContextResponse } from '@leadpilot/shared-types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

interface ErrorEnvelope { error?: { code?: string; message?: string; details?: { path: string; message: string }[] } }

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  return refreshing;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (res.status === 402 && typeof window !== 'undefined') window.dispatchEvent(new Event('lp:billing'));
  if (!res.ok) {
    const env = (json ?? {}) as ErrorEnvelope;
    throw new ApiError(res.status, env.error?.code ?? 'error', env.error?.message ?? 'Request failed', env.error?.details);
  }
  return json as T;
}

/** Cookie-authenticated JSON request. On 401 it tries one silent refresh, then retries once. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, retry = true): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: init.body !== undefined || init.headers ? { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  // A workspace that requires two-step verification holds un-enrolled members at the Security page.
  if (res.status === 403 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/security')) {
    const peek = await res.clone().json().catch(() => null) as { error?: { code?: string } } | null;
    if (peek?.error?.code === 'mfa_enrollment_required') window.location.assign('/security?required=1');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return api<T>(path, init, false);
    // Another tab may have refreshed at the same moment (the cookie is shared): give it a beat, then retry once.
    await new Promise((r) => setTimeout(r, 600));
    return api<T>(path, init, false);
  }
  return parse<T>(res);
}

/** Returned instead of a session when the account has two-step verification on. */
export interface MfaChallenge { mfaRequired: true; challengeToken: string }

export const authApi = {
  me: () => api<AuthContextResponse>('/auth/me'),
  login: (body: { email: string; password: string }, botToken?: string) => api<AuthContextResponse | MfaChallenge>('/auth/login', { method: 'POST', body, ...(botToken ? { headers: { 'x-turnstile-token': botToken } } : {}) }),
  mfaVerify: (body: { challengeToken: string; code?: string; recoveryCode?: string }) => api<AuthContextResponse>('/auth/mfa/verify', { method: 'POST', body }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  switchWorkspace: (tenantId: string) => api<AuthContextResponse>('/auth/switch-workspace', { method: 'POST', body: { tenantId } }),
};

/** Multipart upload (browser sets the boundary). Same silent-refresh behaviour as `api()`. */
export async function apiUpload<T>(path: string, form: FormData, retry = true): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', credentials: 'include', body: form });
  if (res.status === 401 && retry && (await refreshSession())) return apiUpload<T>(path, form, false);
  return parse<T>(res);
}
