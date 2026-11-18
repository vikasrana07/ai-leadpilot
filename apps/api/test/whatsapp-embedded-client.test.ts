import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { LiveWhatsAppClient, MockWhatsAppClient, WhatsAppApiError } from '../src/whatsapp/whatsapp.client.js';

const env = { WHATSAPP_GRAPH_VERSION: 'v21.0', META_APP_ID: '1234567890', META_APP_SECRET: 'super-secret-app-value' } as Env;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
type Call = { url: string; init: RequestInit };
function stub(...responses: (Response | Error)[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? json({});
    if (r instanceof Error) throw r;
    return r;
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('LiveWhatsAppClient: Embedded Signup calls (unverified against Meta; checks the request shape only)', () => {
  it('exchanges the code with a POST form body, never putting the secret or the code in the URL', async () => {
    const calls = stub(json({ access_token: 'EAAB-token', expires_in: 5184000 }));
    const r = await new LiveWhatsAppClient(env).exchangeCode('the-one-time-code');
    expect(r).toEqual({ accessToken: 'EAAB-token', expiresInSec: 5184000 });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v21.0/oauth/access_token');
    expect(calls[0]!.init.method).toBe('POST');
    const body = String(calls[0]!.init.body);
    expect(body).toContain('client_id=1234567890'); expect(body).toContain('client_secret=super-secret-app-value'); expect(body).toContain('code=the-one-time-code');
    expect(calls[0]!.url).not.toMatch(/secret|the-one-time-code/);
  });

  it('reports no expiry when Meta does not send one, and rejects a response without a token', async () => {
    stub(json({ access_token: 'EAAB-token' }));
    expect((await new LiveWhatsAppClient(env).exchangeCode('c')).expiresInSec).toBeNull();
    stub(json({}));
    await expect(new LiveWhatsAppClient(env).exchangeCode('c')).rejects.toThrow(/did not return an access token/);
  });

  it('maps errors without leaking the code or the secret, and marks only server/rate errors retryable', async () => {
    stub(json({ error: { message: 'Invalid verification code', code: 100 } }, 400));
    const bad = (await new LiveWhatsAppClient(env).exchangeCode('secret-code-value').catch((e: unknown) => e)) as WhatsAppApiError;
    expect(bad).toBeInstanceOf(WhatsAppApiError); expect(bad.retryable).toBe(false); expect(bad.code).toBe(100);
    expect(bad.message).not.toContain('secret-code-value'); expect(bad.message).not.toContain('super-secret-app-value');
    stub(json({}, 503));
    expect(((await new LiveWhatsAppClient(env).exchangeCode('c').catch((e: unknown) => e)) as WhatsAppApiError).retryable).toBe(true);
    stub(new Error('connect ECONNREFUSED graph.facebook.com client_secret=super-secret-app-value'));
    const net = (await new LiveWhatsAppClient(env).exchangeCode('c').catch((e: unknown) => e)) as WhatsAppApiError;
    expect(net.retryable).toBe(true); expect(net.message).not.toContain('super-secret-app-value');
  });

  it('refuses to exchange a code when the platform app is not configured', async () => {
    const calls = stub();
    await expect(new LiveWhatsAppClient({ WHATSAPP_GRAPH_VERSION: 'v21.0' } as Env).exchangeCode('c')).rejects.toThrow(/not configured/);
    expect(calls).toHaveLength(0);
  });

  it('verifies the phone belongs to the WABA using the new token (bearer), and rejects a number that is not in it', async () => {
    const calls = stub(json({ data: [{ id: '111', display_phone_number: '+91 98765 43210', verified_name: 'Acme', quality_rating: 'GREEN' }, { id: '222', display_phone_number: '+91 90000 00000' }] }));
    const info = await new LiveWhatsAppClient(env).verifyPhoneInWaba('999888', '111', 'EAAB-token');
    expect(info).toEqual({ displayPhoneNumber: '+91 98765 43210', verifiedName: 'Acme', qualityRating: 'GREEN' });
    expect(calls[0]!.url).toContain('/999888/phone_numbers?'); expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer EAAB-token');
    stub(json({ data: [{ id: '222', display_phone_number: '+91 90000 00000' }] }));
    await expect(new LiveWhatsAppClient(env).verifyPhoneInWaba('999888', '111', 'EAAB-token')).rejects.toThrow(/does not belong/);
  });

  it('subscribes and unsubscribes the app with POST and DELETE on the WABA, and encodes the id', async () => {
    const calls = stub(json({ success: true }), json({ success: true }));
    const c = new LiveWhatsAppClient(env);
    await c.subscribeApp('999888', 'EAAB-token'); await c.unsubscribeApp('999/888?x', 'EAAB-token');
    expect(calls[0]!.init.method).toBe('POST'); expect(calls[0]!.url).toBe('https://graph.facebook.com/v21.0/999888/subscribed_apps');
    expect(calls[1]!.init.method).toBe('DELETE'); expect(calls[1]!.url).toBe('https://graph.facebook.com/v21.0/999%2F888%3Fx/subscribed_apps');
  });
});

describe('MockWhatsAppClient: Embedded Signup stand-in', () => {
  it('accepts mock-ok codes, rejects others, tracks subscriptions, and can model a phone that is not in the WABA', async () => {
    const m = new MockWhatsAppClient();
    expect((await m.exchangeCode('mock-ok-1')).accessToken).toContain('mock-ok-1');
    await expect(m.exchangeCode('expired')).rejects.toBeInstanceOf(WhatsAppApiError);
    expect(m.exchanged).toEqual(['mock-ok-1', 'expired']);
    await m.subscribeApp('w1'); expect(m.subscribed.has('w1')).toBe(true);
    await m.unsubscribeApp('w1'); expect(m.subscribed.has('w1')).toBe(false); expect(m.unsubscribed).toEqual(['w1']);
    expect((await m.verifyPhoneInWaba('w1', '12345', 't')).verifiedName).toBe('Mock Business');
    m.strictWabas.add('w2');
    await expect(m.verifyPhoneInWaba('w2', '12345', 't')).rejects.toThrow(/does not belong/);
    m.phonesInWaba.set('w2', ['12345']); await expect(m.verifyPhoneInWaba('w2', '12345', 't')).resolves.toBeDefined();
  });
});
