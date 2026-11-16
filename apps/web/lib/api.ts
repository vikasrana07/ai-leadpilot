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
  if (!res.ok) {
    const env = (json ?? {}) as ErrorEnvelope;
    throw new ApiError(res.status, env.error?.code ?? 'error', env.error?.message ?? 'Request failed', env.error?.details);
  }
  return json as T;
}

/** Cookie-authenticated JSON request. On 401 it tries one silent refresh, then retries once. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return api<T>(path, init, false);
  }
  return parse<T>(res);
}

export const authApi = {
  me: () => api<AuthContextResponse>('/auth/me'),
  login: (body: { email: string; password: string }) => api<AuthContextResponse>('/auth/login', { method: 'POST', body }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  switchWorkspace: (tenantId: string) => api<AuthContextResponse>('/auth/switch-workspace', { method: 'POST', body: { tenantId } }),
};
