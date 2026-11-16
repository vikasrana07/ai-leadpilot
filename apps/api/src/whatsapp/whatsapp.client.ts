import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export interface WaCredentials { accessToken: string; appSecret: string }
export interface WaSendResult { messageId: string }
export interface WaPhoneInfo { displayPhoneNumber: string; verifiedName: string | null; qualityRating: string | null }

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
}
export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');

/** Error codes Meta documents as rate/throughput limits (130429 throughput, 131056 pair rate limit, 80007 WABA rate limit). */
const RATE_LIMIT_CODES = new Set([130429, 131056, 80007, 4, 17, 613]);

@Injectable()
export class LiveWhatsAppClient implements WhatsAppClient {
  private readonly base: string;
  constructor(@Inject(ENV) env: Env) { this.base = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}`; }

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
  async getMedia(c: WaCredentials, mediaId: string): Promise<{ url: string; mime: string }> {
    return this.call<{ url: string; mime_type: string }>(`/${encodeURIComponent(mediaId)}`, c).then((r) => ({ url: r.url, mime: r.mime_type }));
  }
  async downloadMedia(c: WaCredentials, url: string): Promise<{ data: Buffer; mime: string }> {
    // Media URLs are fetched with the same bearer token; only graph/lookaside Meta hosts are allowed (SSRF guard).
    const host = new URL(url).hostname;
    if (!/(^|\.)(facebook\.com|fbcdn\.net|whatsapp\.net)$/.test(host)) throw new WhatsAppApiError('Unexpected media host', false);
    const res = await fetch(url, { headers: { authorization: `Bearer ${c.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new WhatsAppApiError(`Media download failed (${res.status})`, res.status >= 500);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'application/octet-stream' };
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
    this.take(); const messageId = `wamid.MOCK${++this.n}`;
    this.sent.push({ phoneNumberId, to, kind: 'text', body, messageId }); return { messageId };
  }
  async sendTemplate(phoneNumberId: string, _c: WaCredentials, to: string, name: string, language: string, params: string[]): Promise<WaSendResult> {
    this.take(); const messageId = `wamid.MOCK${++this.n}`;
    this.sent.push({ phoneNumberId, to, kind: 'template', template: { name, language, params }, messageId }); return { messageId };
  }
  async getPhoneNumber(phoneNumberId: string): Promise<WaPhoneInfo> {
    if (this.invalidCredentials) throw new WhatsAppApiError('Invalid OAuth access token', false, 190);
    return { displayPhoneNumber: `+91 98765 ${phoneNumberId.slice(-5).padStart(5, '0')}`, verifiedName: 'Mock Business', qualityRating: 'GREEN' };
  }
  async getMedia(_c: WaCredentials, mediaId: string): Promise<{ url: string; mime: string }> { return { url: `https://lookaside.fbsbx.com/mock/${mediaId}`, mime: 'image/jpeg' }; }
  async downloadMedia(): Promise<{ data: Buffer; mime: string }> { return { data: Buffer.from('mock-image-bytes'), mime: 'image/jpeg' }; }
}
