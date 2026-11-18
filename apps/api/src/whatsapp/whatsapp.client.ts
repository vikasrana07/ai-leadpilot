import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export interface WaCredentials { accessToken: string; appSecret: string }
export interface WaSendResult { messageId: string }
export interface WaPhoneInfo { displayPhoneNumber: string; verifiedName: string | null; qualityRating: string | null }

/** Result of exchanging the one-time Embedded Signup code. `expiresInSec` is null when Meta does not say the token expires. */
export interface WaTokenResult { accessToken: string; expiresInSec: number | null }

export class WhatsAppApiError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: number, readonly retryAfterSec?: number) { super(message); }
}

/**
 * The only surface through which the platform talks to the WhatsApp Cloud API. Two implementations: the real HTTP client
 * (live mode, NOT yet verified against Meta: see PROGRESS.md) and an in-memory mock (dev and tests).
 */
export interface WhatsAppClient {
  sendText(phoneNumberId: string, creds: WaCredentials, to: string, body: string): Promise<WaSendResult>;
  sendTemplate(phoneNumberId: string, creds: WaCredentials, to: string, name: string, language: string, params: string[]): Promise<WaSendResult>;
  getPhoneNumber(phoneNumberId: string, creds: WaCredentials): Promise<WaPhoneInfo>;
  getMedia(creds: WaCredentials, mediaId: string): Promise<{ url: string; mime: string }>;
  downloadMedia(creds: WaCredentials, url: string): Promise<{ data: Buffer; mime: string }>;
  // ---- Embedded Signup (ADR-0012). The live versions follow Meta's documented Graph API and are UNVERIFIED against Meta.
  /** Exchanges the one-time code from the Embedded Signup pop-up for a business token, using the platform app id and secret. */
  exchangeCode(code: string): Promise<WaTokenResult>;
  /** Proves the phone number belongs to the WABA (using the freshly issued token) and returns its details; throws if it does not. */
  verifyPhoneInWaba(wabaId: string, phoneNumberId: string, accessToken: string): Promise<WaPhoneInfo>;
  /** Subscribes the platform app to the WABA so its webhooks are delivered to the platform webhook. */
  subscribeApp(wabaId: string, accessToken: string): Promise<void>;
  unsubscribeApp(wabaId: string, accessToken: string): Promise<void>;
}
export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');

/** Error codes Meta documents as rate/throughput limits (130429 throughput, 131056 pair rate limit, 80007 WABA rate limit). */
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const RATE_LIMIT_CODES = new Set([130429, 131056, 80007, 4, 17, 613]);

@Injectable()
export class LiveWhatsAppClient implements WhatsAppClient {
  private readonly base: string;
  private readonly appId: string | undefined;
  private readonly appSecret: string | undefined;
  constructor(@Inject(ENV) env: Env) {
    this.base = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}`;
    this.appId = env.META_APP_ID; this.appSecret = env.META_APP_SECRET;
  }

  private async call<T>(path: string, creds: WaCredentials, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path.startsWith('http') ? path : `${this.base}${path}`, {
        method: init.method ?? 'GET',
        headers: { authorization: `Bearer ${creds.accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new WhatsAppApiError(`Network error talking to WhatsApp: ${e instanceof Error ? e.message : 'unknown'}`, true);
    }
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    const code = body.error?.code;
    const rateLimited = res.status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code));
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new WhatsAppApiError(body.error?.message ?? `WhatsApp API error ${res.status}`, rateLimited || res.status >= 500, code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }

  async sendText(id: string, c: WaCredentials, to: string, body: string): Promise<WaSendResult> {
    const r = await this.call<{ messages: { id: string }[] }>(`/${id}/messages`, c, { method: 'POST', body: { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } } });
    return { messageId: r.messages[0]?.id ?? '' };
  }
  async sendTemplate(id: string, c: WaCredentials, to: string, name: string, language: string, params: string[]): Promise<WaSendResult> {
    const components = params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [];
    const r = await this.call<{ messages: { id: string }[] }>(`/${id}/messages`, c, { method: 'POST', body: { messaging_product: 'whatsapp', to, type: 'template', template: { name, language: { code: language }, components } } });
    return { messageId: r.messages[0]?.id ?? '' };
  }
  async getPhoneNumber(id: string, c: WaCredentials): Promise<WaPhoneInfo> {
    const r = await this.call<{ display_phone_number: string; verified_name?: string; quality_rating?: string }>(`/${id}?fields=display_phone_number,verified_name,quality_rating`, c);
    return { displayPhoneNumber: r.display_phone_number, verifiedName: r.verified_name ?? null, qualityRating: r.quality_rating ?? null };
  }
  // ---- Embedded Signup. Error messages never include the code, the token or the app secret.
  async exchangeCode(code: string): Promise<WaTokenResult> {
    if (!this.appId || !this.appSecret) throw new WhatsAppApiError('Embedded Signup is not configured', false);
    // POST with a form body (not a query string) so the app secret and the code never appear in a URL or a proxy log.
    const body = new URLSearchParams({ client_id: this.appId, client_secret: this.appSecret, code });
    let res: Response;
    try { res = await fetch(`${this.base}/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000) }); }
    catch { throw new WhatsAppApiError('Network error talking to WhatsApp', true); }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
      throw new WhatsAppApiError(j.error?.message ?? `WhatsApp API error ${res.status}`, res.status >= 500 || res.status === 429, j.error?.code);
    }
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new WhatsAppApiError('Meta did not return an access token', false);
    return { accessToken: j.access_token, expiresInSec: typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : null };
  }
  async verifyPhoneInWaba(wabaId: string, phoneNumberId: string, accessToken: string): Promise<WaPhoneInfo> {
    const c = { accessToken, appSecret: '' };
    const r = await this.call<{ data?: { id: string; display_phone_number: string; verified_name?: string; quality_rating?: string }[] }>(`/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100`, c);
    const hit = r.data?.find((p) => p.id === phoneNumberId);
    if (!hit) throw new WhatsAppApiError('That phone number does not belong to this WhatsApp Business account', false, 100);
    return { displayPhoneNumber: hit.display_phone_number, verifiedName: hit.verified_name ?? null, qualityRating: hit.quality_rating ?? null };
  }
  async subscribeApp(wabaId: string, accessToken: string): Promise<void> {
    await this.call(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { accessToken, appSecret: '' }, { method: 'POST' });
  }
  async unsubscribeApp(wabaId: string, accessToken: string): Promise<void> {
    await this.call(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { accessToken, appSecret: '' }, { method: 'DELETE' });
  }
  async getMedia(c: WaCredentials, mediaId: string): Promise<{ url: string; mime: string }> {
    return this.call<{ url: string; mime_type: string }>(`/${encodeURIComponent(mediaId)}`, c).then((r) => ({ url: r.url, mime: r.mime_type }));
  }
  async downloadMedia(c: WaCredentials, url: string): Promise<{ data: Buffer; mime: string }> {
    // Media URLs are fetched with the same bearer token, so they are a credential-exfiltration (SSRF) risk: HTTPS only, Meta hosts only,
    // and redirects are never followed (a redirect to another host would carry the token with it).
    let u: URL;
    try { u = new URL(url); } catch { throw new WhatsAppApiError('Unexpected media URL', false); }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !/(^|\.)(facebook\.com|fbcdn\.net|whatsapp\.net)$/.test(u.hostname)) throw new WhatsAppApiError('Unexpected media host', false);
    const res = await fetch(u, { headers: { authorization: `Bearer ${c.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new WhatsAppApiError(`Media download failed (${res.status})`, res.status >= 500);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_MEDIA_BYTES) throw new WhatsAppApiError('Media file is too large', false);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_MEDIA_BYTES) throw new WhatsAppApiError('Media file is too large', false);
    return { data, mime: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}

export interface MockSent { phoneNumberId: string; to: string; kind: 'text' | 'template'; body?: string; template?: { name: string; language: string; params: string[] }; messageId: string }

/** In-memory stand-in used in development and tests. Never used when WHATSAPP_MODE=live. */
@Injectable()
export class MockWhatsAppClient implements WhatsAppClient {
  sent: MockSent[] = [];
  /** Set to make the next send fail, e.g. { retryable: true, code: 130429 }. */
  failNext: WhatsAppApiError | null = null;
  invalidCredentials = false;
  private n = 0;

  private take(): void { const f = this.failNext; if (f) { this.failNext = null; throw f; } }

  async sendText(phoneNumberId: string, _c: WaCredentials, to: string, body: string): Promise<WaSendResult> {
    this.take(); const messageId = `wamid.MOCK${++this.n}.${randomUUID().slice(0, 8)}`; // unique across restarts, like real provider ids
    this.sent.push({ phoneNumberId, to, kind: 'text', body, messageId }); return { messageId };
  }
  async sendTemplate(phoneNumberId: string, _c: WaCredentials, to: string, name: string, language: string, params: string[]): Promise<WaSendResult> {
    this.take(); const messageId = `wamid.MOCK${++this.n}.${randomUUID().slice(0, 8)}`;
    this.sent.push({ phoneNumberId, to, kind: 'template', template: { name, language, params }, messageId }); return { messageId };
  }
  async getPhoneNumber(phoneNumberId: string): Promise<WaPhoneInfo> {
    if (this.invalidCredentials) throw new WhatsAppApiError('Invalid OAuth access token', false, 190);
    return { displayPhoneNumber: `+91 98765 ${phoneNumberId.slice(-5).padStart(5, '0')}`, verifiedName: 'Mock Business', qualityRating: 'GREEN' };
  }
  // ---- Embedded Signup mock. Codes starting "mock-ok" succeed; any other code is rejected like an expired or invalid one.
  exchanged: string[] = [];
  subscribed = new Set<string>();
  unsubscribed: string[] = [];
  /** WABA ids whose phone numbers (other than the ones listed in `phonesInWaba`) are reported as not belonging to it. */
  strictWabas = new Set<string>();
  phonesInWaba = new Map<string, string[]>();
  failSubscribe: WhatsAppApiError | null = null;
  async exchangeCode(code: string): Promise<WaTokenResult> {
    this.exchanged.push(code);
    if (!code.startsWith('mock-ok')) throw new WhatsAppApiError('Invalid verification code', false, 100);
    return { accessToken: `mock-business-token-${code}`, expiresInSec: null };
  }
  async verifyPhoneInWaba(wabaId: string, phoneNumberId: string, _accessToken?: string): Promise<WaPhoneInfo> {
    if (this.strictWabas.has(wabaId) && !(this.phonesInWaba.get(wabaId) ?? []).includes(phoneNumberId)) throw new WhatsAppApiError('That phone number does not belong to this WhatsApp Business account', false, 100);
    return this.getPhoneNumber(phoneNumberId);
  }
  async subscribeApp(wabaId: string): Promise<void> { const f = this.failSubscribe; if (f) { this.failSubscribe = null; throw f; } this.subscribed.add(wabaId); }
  async unsubscribeApp(wabaId: string): Promise<void> { this.unsubscribed.push(wabaId); this.subscribed.delete(wabaId); }
  async getMedia(_c: WaCredentials, mediaId: string): Promise<{ url: string; mime: string }> { return { url: `https://lookaside.fbsbx.com/mock/${mediaId}`, mime: 'image/jpeg' }; }
  async downloadMedia(): Promise<{ data: Buffer; mime: string }> { return { data: Buffer.from('mock-image-bytes'), mime: 'image/jpeg' }; }
}
