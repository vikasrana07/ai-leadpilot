import { Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Logger, NotFoundException, Post, Query, Req, Res, UnauthorizedException, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../common/decorators.js';
import type { AppRequest } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { ChannelsService } from '../channels/channels.module.js';
import { InboundService, type InboundMessage } from './inbound.service.js';
import { v7 as uuidv7 } from 'uuid';

const waMessage = z.object({
  from: z.string(), id: z.string(), timestamp: z.string(), type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), mime_type: z.string().optional(), sha256: z.string().optional(), caption: z.string().optional() }).optional(),
  video: z.object({ id: z.string(), mime_type: z.string().optional(), sha256: z.string().optional(), caption: z.string().optional() }).optional(),
  audio: z.object({ id: z.string(), mime_type: z.string().optional(), sha256: z.string().optional() }).optional(),
  document: z.object({ id: z.string(), mime_type: z.string().optional(), sha256: z.string().optional(), caption: z.string().optional(), filename: z.string().optional() }).optional(),
  button: z.object({ text: z.string() }).optional(),
  interactive: z.object({ button_reply: z.object({ title: z.string() }).optional(), list_reply: z.object({ title: z.string() }).optional() }).optional(),
});
const waStatus = z.object({ id: z.string(), status: z.enum(['sent', 'delivered', 'read', 'failed']), timestamp: z.string(), errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional() });
const waPayload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({ changes: z.array(z.object({ field: z.string(), value: z.object({
    metadata: z.object({ phone_number_id: z.string() }).optional(),
    contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
    messages: z.array(waMessage).optional(),
    statuses: z.array(waStatus).optional(),
  }) })) })),
});

/** Maps a WhatsApp message to our model. Unsupported kinds (stickers, locations, reactions…) become a readable placeholder. */
export function mapWaMessage(m: z.infer<typeof waMessage>): InboundMessage {
  const at = new Date(Number(m.timestamp) * 1000);
  const base = { externalId: m.id, at: Number.isNaN(at.getTime()) ? new Date() : at };
  if (m.type === 'text' && m.text) return { ...base, type: 'TEXT', body: m.text.body };
  if (m.type === 'button' && m.button) return { ...base, type: 'TEXT', body: m.button.text };
  if (m.type === 'interactive') return { ...base, type: 'TEXT', body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[interactive reply]' };
  const media = (kind: 'image' | 'video' | 'audio' | 'document', t: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT'): InboundMessage | null => {
    const x = m[kind] as { id: string; mime_type?: string; sha256?: string; caption?: string; filename?: string } | undefined;
    if (m.type !== kind || !x) return null;
    return { ...base, type: t, body: x.caption ?? null, media: { id: x.id, ...(x.mime_type ? { mime: x.mime_type } : {}), ...(x.filename ? { filename: x.filename } : {}), ...(x.caption ? { caption: x.caption } : {}), ...(x.sha256 ? { sha256: x.sha256 } : {}) } };
  };
  return media('image', 'IMAGE') ?? media('video', 'VIDEO') ?? media('audio', 'AUDIO') ?? media('document', 'DOCUMENT') ?? { ...base, type: 'TEXT', body: `[Unsupported message type: ${m.type}]` };
}

/** An unfinished webhook older than this is presumed crashed and is re-processed when Meta redelivers it. */
export const STALE_WEBHOOK_MS = 45_000;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type WaPayload = z.infer<typeof waPayload>;
export interface WaChannelRef { id: string; tenant_id: string; external_id: string | null }

/**
 * Stores one webhook delivery for one channel and processes it. Shared by the per-channel webhook (manual connections, signed with the
 * channel's own app secret) and the platform webhook (Embedded Signup, signed with the platform secret) so both behave identically:
 * identical redeliveries are acknowledged and ignored, a delivery that crashed half-way is re-run once it is clearly dead, and a
 * processing failure deletes the stored row and rethrows so Meta retries. `stored` is what is kept in webhook_events: for the platform
 * webhook it is only THIS channel's part of the request, never another workspace's messages.
 */
@Injectable()
export class WhatsappWebhookProcessor {
  private readonly log = new Logger('WhatsAppWebhook');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(InboundService) private readonly inbound: InboundService) {}

  async handle(ch: WaChannelRef, payload: WaPayload, payloadHash: string, stored: object): Promise<{ status: string }> {
    const fresh = await this.db.tenantTx({ tenantId: ch.tenant_id }, (tx) => tx.webhookEvent.createMany({ data: [{ id: uuidv7(), tenantId: ch.tenant_id, channelId: ch.id, provider: 'whatsapp', payloadHash, payload: stored }], skipDuplicates: true }));
    if (fresh.count === 0) {
      // A row that exists but never reached `processed` means an earlier attempt crashed mid-way (the error path deletes the row, a crash cannot).
      // Treating Meta's redelivery as a duplicate would silently lose that customer message, so re-run it once the first attempt is clearly dead.
      // Ingest is idempotent (messages are unique per provider message id), so re-processing is safe.
      const prior = await this.db.tenantTx({ tenantId: ch.tenant_id }, (tx) => tx.webhookEvent.findUnique({ where: { channelId_payloadHash: { channelId: ch.id, payloadHash } }, select: { status: true, createdAt: true } }));
      const stale = prior && prior.status !== 'processed' && Date.now() - prior.createdAt.getTime() > STALE_WEBHOOK_MS;
      if (!stale) return { status: 'duplicate' };
    }

    try {
      for (const entry of payload.entry) for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const v = change.value;
        // The payload must be addressed to THIS channel's number; anything else is not ours to process.
        if (v.metadata && ch.external_id && v.metadata.phone_number_id !== ch.external_id) continue;
        const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? '']));
        for (const m of v.messages ?? []) {
          const name = names.get(m.from) || `+${m.from}`;
          await this.inbound.ingest({ tenantId: ch.tenant_id, channel: { id: ch.id, type: 'WHATSAPP' }, externalThreadId: m.from, contact: { name, phone: `+${m.from}` }, message: mapWaMessage(m), source: 'whatsapp' });
        }
        for (const st of v.statuses ?? []) await this.inbound.applyStatus(ch.tenant_id, ch.id, st.id, st.status, new Date(Number(st.timestamp) * 1000), st.errors?.[0]);
      }
      await this.db.tenantTx({ tenantId: ch.tenant_id }, (tx) => tx.webhookEvent.updateMany({ where: { channelId: ch.id, payloadHash }, data: { status: 'processed' } }));
      return { status: 'ok' };
    } catch (e) {
      await this.db.tenantTx({ tenantId: ch.tenant_id }, (tx) => tx.webhookEvent.deleteMany({ where: { channelId: ch.id, payloadHash } })).catch(() => undefined); // let the retry be processed
      this.log.error(`Webhook processing failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }
}

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly log = new Logger('WhatsAppWebhook');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(ChannelsService) private readonly channels: ChannelsService, @Inject(WhatsappWebhookProcessor) private readonly processor: WhatsappWebhookProcessor) {}

  private async channelByKey(key: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(key)) return null;
    const rows = await this.db.userTx(null, (tx) => tx.$queryRaw<{ id: string; tenant_id: string; status: string; external_id: string | null; config: { verifyToken?: string } }[]>`SELECT * FROM find_channel_by_webhook_key(${key})`);
    return rows[0] ?? null;
  }

  /** Meta's one-time subscription handshake. */
  @Public() @SkipThrottle() @Get(':key')
  async verify(@Param('key') key: string, @Query('hub.mode') mode: string | undefined, @Query('hub.verify_token') token: string | undefined, @Query('hub.challenge') challenge: string | undefined, @Res() res: Response): Promise<void> {
    const ch = await this.channelByKey(key);
    const expected = ch?.config.verifyToken;
    if (!ch || mode !== 'subscribe' || !token || !expected || !safeEqual(token, expected) || !challenge) throw new ForbiddenException({ code: 'verification_failed', message: 'Verification failed' });
    res.type('text/plain').send(challenge);
  }

  /**
   * Inbound events. Order matters: authenticate (HMAC with this channel's app secret over the RAW body) BEFORE parsing,
   * record the raw delivery (identical redeliveries are acknowledged and ignored), then process. A processing failure
   * returns 500 so Meta retries; all writes are idempotent so a retry is safe.
   */
  @Public() @SkipThrottle() @Post(':key') @HttpCode(200)
  async receive(@Param('key') key: string, @Req() req: AppRequest & { rawBody?: Buffer }): Promise<{ status: string }> {
    const ch = await this.channelByKey(key);
    if (!ch) throw new UnauthorizedException({ code: 'unknown_channel', message: 'Unknown webhook' });
    const raw = req.rawBody;
    const sig = req.header('x-hub-signature-256');
    if (!raw || !sig?.startsWith('sha256=')) throw new UnauthorizedException({ code: 'invalid_signature', message: 'Invalid signature' });
    const { creds } = await this.channels.credentialsFor(ch.tenant_id, ch.id);
    const expected = createHmac('sha256', creds.appSecret).update(raw).digest('hex');
    if (!safeEqual(sig.slice(7), expected)) {
      this.log.warn(`Rejected webhook with a bad signature for channel ${ch.id}`);
      throw new UnauthorizedException({ code: 'invalid_signature', message: 'Invalid signature' });
    }
    if (ch.status !== 'ACTIVE') return { status: 'ignored' };

    let json: unknown;
    try { json = JSON.parse(raw.toString('utf8')); } catch { return { status: 'ignored' }; }
    const parsed = waPayload.safeParse(json);
    if (!parsed.success) return { status: 'ignored' };
    return this.processor.handle(ch, parsed.data, createHash('sha256').update(raw).digest('hex'), json as object);
  }
}

/**
 * The ONE webhook of the platform Meta app (Embedded Signup, ADR-0012). Meta delivers every connected workspace's events here, so
 * a request is authenticated with the PLATFORM app secret and each entry is routed to its workspace by phone number id. A number that
 * belongs to a manually connected channel is never processed here (that channel has its own URL and its own secret), and another
 * workspace's messages are never stored with this workspace's delivery. Unverified against Meta.
 */
@Controller('webhooks/whatsapp')
export class PlatformWhatsappWebhookController {
  private readonly log = new Logger('WhatsAppPlatformWebhook');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env, @Inject(WhatsappWebhookProcessor) private readonly processor: WhatsappWebhookProcessor) {}

  private enabled(): void { if (this.env.EMBEDDED_SIGNUP_MODE === 'off') throw new NotFoundException({ code: 'not_found', message: 'Not found' }); }

  /** Meta's subscription handshake for the platform app. */
  @Public() @SkipThrottle() @Get()
  verify(@Query('hub.mode') mode: string | undefined, @Query('hub.verify_token') token: string | undefined, @Query('hub.challenge') challenge: string | undefined, @Res() res: Response): void {
    this.enabled();
    const expected = this.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode !== 'subscribe' || !token || !expected || !safeEqual(token, expected) || !challenge) throw new ForbiddenException({ code: 'verification_failed', message: 'Verification failed' });
    res.type('text/plain').send(challenge);
  }

  @Public() @SkipThrottle() @Post() @HttpCode(200)
  async receive(@Req() req: AppRequest & { rawBody?: Buffer }): Promise<{ status: string; processed: number; ignored: number }> {
    this.enabled();
    const raw = req.rawBody; const sig = req.header('x-hub-signature-256'); const secret = this.env.META_APP_SECRET;
    if (!secret || !raw || !sig?.startsWith('sha256=')) throw new UnauthorizedException({ code: 'invalid_signature', message: 'Invalid signature' });
    if (!safeEqual(sig.slice(7), createHmac('sha256', secret).update(raw).digest('hex'))) {
      this.log.warn('Rejected platform webhook with a bad signature');
      throw new UnauthorizedException({ code: 'invalid_signature', message: 'Invalid signature' });
    }
    let json: unknown;
    try { json = JSON.parse(raw.toString('utf8')); } catch { return { status: 'ignored', processed: 0, ignored: 0 }; }
    const parsed = waPayload.safeParse(json);
    if (!parsed.success) return { status: 'ignored', processed: 0, ignored: 0 };

    // Group the changes by the phone number they are addressed to; a change without one cannot be routed.
    const byPhone = new Map<string, WaPayload['entry'][number]['changes']>();
    let ignored = 0;
    for (const entry of parsed.data.entry) for (const change of entry.changes) {
      const phone = change.value.metadata?.phone_number_id;
      if (!phone) { ignored++; continue; }
      byPhone.set(phone, [...(byPhone.get(phone) ?? []), change]);
    }
    const payloadHash = createHash('sha256').update(raw).digest('hex');
    let processed = 0; let duplicates = 0;
    for (const [phone, changes] of byPhone) {
      const ch = (await this.db.userTx(null, (tx) => tx.$queryRaw<{ id: string; tenant_id: string; status: string; mode: string }[]>`SELECT * FROM find_channel_by_phone_number_id(${phone})`))[0];
      if (!ch || ch.mode !== 'platform' || ch.status !== 'ACTIVE') { ignored += changes.length; continue; }
      // Only this channel's part of the request is stored and processed: never another workspace's messages.
      const part: WaPayload = { object: 'whatsapp_business_account', entry: [{ changes }] };
      const r = await this.processor.handle({ id: ch.id, tenant_id: ch.tenant_id, external_id: phone }, part, payloadHash, part);
      if (r.status === 'duplicate') duplicates++; else processed++;
    }
    if (ignored > 0) this.log.warn(`Platform webhook: ${ignored} change(s) were not for an active Facebook-connected channel and were ignored`);
    return { status: processed > 0 ? 'ok' : duplicates > 0 ? 'duplicate' : 'ignored', processed, ignored };
  }
}
