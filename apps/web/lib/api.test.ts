import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const reply = (status: number, body?: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body ?? null, { status })));
afterEach(() => vi.unstubAllGlobals());

describe('api() response parsing', () => {
  it('returns null (not undefined) for an empty 200 body, so nullable endpoints work as TanStack Query data', async () => {
    reply(200, ''); // GET /billing/profile and GET /widget-config answer `null` as an empty body
    expect(await api<unknown>('/billing/profile')).toBeNull();
  });

  it('still returns undefined for 204 No Content and parses JSON bodies', async () => {
    reply(204);
    expect(await api<void>('/x', { method: 'DELETE' })).toBeUndefined();
    reply(200, JSON.stringify({ legalName: 'Acme' }));
    expect(await api<{ legalName: string }>('/billing/profile')).toEqual({ legalName: 'Acme' });
  });

  it('throws ApiError with the server code for error responses', async () => {
    reply(409, JSON.stringify({ error: { code: 'billing_profile_required', message: 'Add your billing details' } }));
    await expect(api('/billing/subscribe', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 409, code: 'billing_profile_required' });
    reply(409, JSON.stringify({ error: { code: 'x', message: 'm' } }));
    await expect(api('/y')).rejects.toBeInstanceOf(ApiError);
  });
});
