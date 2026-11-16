import { Controller, ForbiddenException, Get, HttpCode, Inject, Logger, Post, Query, Req, Res, UnauthorizedException, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../common/decorators.js';
import type { AppRequest } from '../common/request-context.js';
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

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly log = new Logger('WhatsAppWebhook');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(ChannelsService) private readonly channels: ChannelsService, @Inject(InboundService) private readonly inbound: InboundService) {}

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

    const payloadHash = createHash('sha256').update(raw).digest('hex');
    const fresh = await this.db.tenantTx({ tenantId: ch.tenant_id }, (tx) => tx.webhookEvent.createMany({ data: [{ id: uuidv7(), tenantId: ch.tenant_id, channelId: ch.id, provider: 'whatsapp', payloadHash, payload: json as object }], skipDuplicates: true }));
    if (fresh.count === 0) return { status: 'duplicate' };

    try {
      for (const entry of parsed.data.entry) for (const change of entry.changes) {
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
