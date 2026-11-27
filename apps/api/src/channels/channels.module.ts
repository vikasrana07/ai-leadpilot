import { RequireFeature } from '../common/billing-meta.js';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { channelEmbeddedSchema, channelWhatsappSchema, templateSchema, widgetConfigSchema } from '@leadpilot/validation';
import { Throttle } from '@nestjs/throttler';
import { MetaCallbacksController } from './meta-callbacks.js';
import type { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SecretBox } from '../crypto/secret-box.js';
import { DbService } from '../db/db.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { TelephonyController } from './telephony.controller.js';
import { TelephonyService } from './telephony.service.js';
import { WHATSAPP_CLIENT, WhatsAppApiError, type WaCredentials, type WhatsAppClient } from '../whatsapp/whatsapp.client.js';

type WhatsappInput = z.infer<typeof channelWhatsappSchema>;
type EmbeddedInput = z.infer<typeof channelEmbeddedSchema>;
const EMBEDDED_THROTTLE = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SecretBox) private readonly box: SecretBox,
    @Inject(WHATSAPP_CLIENT) private readonly wa: WhatsAppClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private apiBase(): string { return this.env.PUBLIC_API_URL ?? `http://localhost:${this.env.API_PORT}`; }
  private aad(tenantId: string, provider: string): string { return `${tenantId}:${provider}`; }

  private rec(ctx: TenantRequestContext, tx: Parameters<AuditService['record']>[0], action: string, id: string, metadata: Record<string, string | boolean> = {}) {
    return this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action, resourceType: 'channel', resourceId: id, metadata, requestId: ctx.requestId, ip: ctx.ip });
  }

  /** Public, secret-free view. Secrets are never returned after they are saved. */
  private view(c: { id: string; type: string; name: string; status: string; externalId: string | null; webhookKey: string | null; config: unknown; credentialId: string | null; createdAt: Date }, cred?: { lastVerifiedAt: Date | null } | null) {
    const cfg = (c.config ?? {}) as Record<string, string>;
    const platform = cfg.mode === 'platform';
    return {
      id: c.id, type: c.type, name: c.name, status: c.status, mode: platform ? 'platform' : 'manual', phoneNumberId: c.externalId, displayPhone: cfg.displayPhone ?? null, wabaId: cfg.wabaId ?? null,
      // Platform (Embedded Signup) channels are served by the one platform webhook: there is no per-channel URL or verify token to show.
      webhookUrl: !platform && c.webhookKey ? `${this.apiBase()}/webhooks/whatsapp/${c.webhookKey}` : null, verifyToken: !platform ? (cfg.verifyToken ?? null) : null,
      credentialsSaved: c.credentialId !== null, lastVerifiedAt: cred?.lastVerifiedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
    };
  }

  list(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const channels = await tx.channel.findMany({ where: { tenantId: ctx.tenantId, type: 'WHATSAPP' }, orderBy: { createdAt: 'asc' } });
      const creds = await tx.integrationCredential.findMany({ where: { id: { in: channels.map((c) => c.credentialId).filter((x): x is string => x !== null) } }, select: { id: true, lastVerifiedAt: true } });
      return channels.map((c) => this.view(c, creds.find((x) => x.id === c.credentialId)));
    });
  }

  /**
   * What the browser needs to open Meta's Embedded Signup pop-up. The app id and configuration id are public by design (the pop-up
   * shows them to anyone); the app SECRET is never included. `mode` tells the page whether to use Facebook, the offline stand-in or hide the option.
   */
  embeddedConfig() {
    const mode = this.env.EMBEDDED_SIGNUP_MODE;
    return { mode, appId: mode === 'live' ? (this.env.META_APP_ID ?? null) : null, configId: mode === 'live' ? (this.env.META_ES_CONFIG_ID ?? null) : null, graphVersion: this.env.WHATSAPP_GRAPH_VERSION };
  }

  /** Validates the credentials against the provider BEFORE anything is stored. */
  async connectWhatsapp(ctx: TenantRequestContext, input: WhatsappInput) {
    const creds: WaCredentials = { accessToken: input.accessToken, appSecret: input.appSecret };
    let info;
    try { info = await this.wa.getPhoneNumber(input.phoneNumberId, creds); }
    catch (e) { throw new BadRequestException({ code: 'whatsapp_verification_failed', message: e instanceof WhatsAppApiError ? `WhatsApp rejected these details: ${e.message}` : 'Could not reach WhatsApp to verify these details' }); }
    return this.db.tenantTx(ctx, async (tx) => {
      if (await tx.channel.findFirst({ where: { tenantId: ctx.tenantId, type: 'WHATSAPP', externalId: input.phoneNumberId }, select: { id: true } })) throw new ConflictException({ code: 'already_connected', message: 'This WhatsApp number is already connected' });
      const sealed = await this.box.seal({ accessToken: input.accessToken, appSecret: input.appSecret }, this.aad(ctx.tenantId, 'whatsapp'));
      const credId = uuidv7();
      await tx.integrationCredential.create({ data: { id: credId, tenantId: ctx.tenantId, provider: 'whatsapp', ...sealed, lastVerifiedAt: new Date() } });
      const channel = await tx.channel.create({ data: {
        id: uuidv7(), tenantId: ctx.tenantId, type: 'WHATSAPP', name: input.name, externalId: input.phoneNumberId, webhookKey: randomBytes(24).toString('base64url'), credentialId: credId,
        config: { displayPhone: info.displayPhoneNumber, wabaId: input.wabaId, verifyToken: randomBytes(18).toString('hex'), verifiedName: info.verifiedName ?? '' },
      } });
      await this.rec(ctx, tx, 'integration.whatsapp_connected', channel.id, { phoneNumberId: input.phoneNumberId });
      return this.view(channel, { lastVerifiedAt: new Date() });
    });
  }

  /**
   * Embedded Signup (ADR-0012). The browser only hands us the one-time code and the ids Meta reported; everything that matters is
   * proven server-side: the code is exchanged for a token, that token must see the phone number inside the WABA, and no other
   * workspace may own the number. Nothing is stored until all of that succeeded. The live provider calls are UNVERIFIED against Meta.
   */
  async connectEmbedded(ctx: TenantRequestContext, input: EmbeddedInput) {
    const channel = await this.connectEmbeddedCore(ctx, input);
    // Pull the account's templates right away so the owner can use approved ones at once; a failure here never undoes the connection.
    await this.syncTemplates(ctx).catch((e: unknown) => new Logger('Channels').warn(`Template sync after connecting failed: ${e instanceof Error ? e.message : 'unknown error'}`));
    return channel;
  }

  private async connectEmbeddedCore(ctx: TenantRequestContext, input: EmbeddedInput) {
    if (this.env.EMBEDDED_SIGNUP_MODE === 'off') throw new NotFoundException({ code: 'embedded_signup_disabled', message: 'Connecting with Facebook is not available yet' });
    const fail = (e: unknown, what: string) => new BadRequestException({ code: 'embedded_signup_failed', message: e instanceof WhatsAppApiError ? `${what}: ${e.message}` : `Could not reach WhatsApp to ${what.toLowerCase()}` });

    // Who owns this number already? (SECURITY DEFINER lookup: it sees every workspace, returns ids only.)
    const owner = (await this.db.prisma.$queryRaw<{ id: string; tenant_id: string; mode: string }[]>`SELECT id, tenant_id, mode FROM find_channel_by_phone_number_id(${input.phoneNumberId})`)[0];
    if (owner && owner.tenant_id !== ctx.tenantId) throw new ConflictException({ code: 'already_connected', message: 'This WhatsApp number is already connected to another LeadPilot workspace' });
    if (owner && owner.mode !== 'platform') throw new ConflictException({ code: 'already_connected_manually', message: 'This number is connected with your own Meta app. Disconnect it first, then connect it with Facebook.' });

    let token;
    try { token = await this.wa.exchangeCode(input.code); } catch (e) { throw fail(e, 'Meta did not accept the sign-in'); }
    let info;
    try { info = await this.wa.verifyPhoneInWaba(input.wabaId, input.phoneNumberId, token.accessToken); } catch (e) { throw fail(e, 'Could not confirm the phone number'); }
    try { await this.wa.subscribeApp(input.wabaId, token.accessToken); } catch (e) { throw fail(e, 'Could not turn on message delivery'); }

    const sealed = await this.box.seal({ accessToken: token.accessToken, mode: 'platform' }, this.aad(ctx.tenantId, 'whatsapp'));
    const config = { mode: 'platform', displayPhone: info.displayPhoneNumber, wabaId: input.wabaId, verifiedName: info.verifiedName ?? '', ...(token.expiresInSec ? { tokenExpiresAt: new Date(Date.now() + token.expiresInSec * 1000).toISOString() } : {}) };
    try {
      return await this.db.tenantTx(ctx, async (tx) => {
        const existing = owner ? await tx.channel.findFirst({ where: { id: owner.id, tenantId: ctx.tenantId, type: 'WHATSAPP' } }) : null;
        if (existing?.credentialId) {
          // Same workspace connecting the same number again (re-run after a problem): refresh the token, keep the channel.
          await tx.integrationCredential.update({ where: { id: existing.credentialId }, data: { ...sealed, lastVerifiedAt: new Date(), status: 'active' } });
          const channel = await tx.channel.update({ where: { id: existing.id }, data: { status: 'ACTIVE', name: input.name, config } });
          await this.rec(ctx, tx, 'integration.whatsapp_connected_embedded', channel.id, { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, reconnect: true });
          return this.view(channel, { lastVerifiedAt: new Date() });
        }
        const credId = uuidv7();
        await tx.integrationCredential.create({ data: { id: credId, tenantId: ctx.tenantId, provider: 'whatsapp', ...sealed, lastVerifiedAt: new Date() } });
        const channel = await tx.channel.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, type: 'WHATSAPP', name: input.name, externalId: input.phoneNumberId, webhookKey: randomBytes(24).toString('base64url'), credentialId: credId, config } });
        await this.rec(ctx, tx, 'integration.whatsapp_connected_embedded', channel.id, { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId });
        return this.view(channel, { lastVerifiedAt: new Date() });
      });
    } catch (e) {
      // A concurrent connect of the same number by another workspace: the database-level unique index decides.
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'already_connected', message: 'This WhatsApp number is already connected to another LeadPilot workspace' });
      throw e;
    }
  }

  async test(ctx: TenantRequestContext, id: string) {
    const { channel, creds } = await this.credentialsFor(ctx.tenantId, id, ctx.userId);
    try {
      const info = await this.wa.getPhoneNumber(channel.externalId ?? '', creds);
      await this.db.tenantTx(ctx, async (tx) => {
        await tx.integrationCredential.updateMany({ where: { id: channel.credentialId as string }, data: { lastVerifiedAt: new Date(), status: 'active' } });
        await tx.channel.update({ where: { id }, data: { status: 'ACTIVE' } });
      });
      return { ok: true, displayPhone: info.displayPhoneNumber, qualityRating: info.qualityRating };
    } catch (e) {
      await this.db.tenantTx(ctx, (tx) => tx.channel.update({ where: { id }, data: { status: 'ERROR' } }));
      return { ok: false, error: e instanceof WhatsAppApiError ? e.message : 'Could not reach WhatsApp' };
    }
  }

  /** Rotates the access token / app secret. The webhook URL stays the same. */
  async updateCredentials(ctx: TenantRequestContext, id: string, input: { accessToken: string; appSecret: string }) {
    const { channel } = await this.credentialsFor(ctx.tenantId, id, ctx.userId);
    if ((channel.config as { mode?: string } | null)?.mode === 'platform') throw new BadRequestException({ code: 'platform_channel', message: 'This number was connected with Facebook. To change it, connect it again with Facebook.' });
    try { await this.wa.getPhoneNumber(channel.externalId ?? '', input); } catch (e) { throw new BadRequestException({ code: 'whatsapp_verification_failed', message: e instanceof WhatsAppApiError ? `WhatsApp rejected these details: ${e.message}` : 'Could not verify' }); }
    await this.db.tenantTx(ctx, async (tx) => {
      const sealed = await this.box.seal(input, this.aad(ctx.tenantId, 'whatsapp'));
      await tx.integrationCredential.update({ where: { id: channel.credentialId as string }, data: { ...sealed, lastVerifiedAt: new Date(), status: 'active' } });
      await tx.channel.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.rec(ctx, tx, 'integration.whatsapp_credentials_rotated', id);
    });
  }

  async disable(ctx: TenantRequestContext, id: string) {
    const toUnsubscribe = await this.db.tenantTx(ctx, async (tx) => {
      const ch = await tx.channel.findFirst({ where: { id, tenantId: ctx.tenantId, type: 'WHATSAPP' } });
      if (!ch) throw new NotFoundException({ code: 'not_found', message: 'Channel not found' });
      await tx.channel.update({ where: { id }, data: { status: 'DISABLED' } });
      await this.rec(ctx, tx, 'integration.whatsapp_disabled', id);
      const cfg = (ch.config ?? {}) as { mode?: string; wabaId?: string };
      if (cfg.mode !== 'platform' || !cfg.wabaId) return null;
      // A WABA can hold several numbers; only stop delivery for it when no other active Facebook-connected number of this workspace uses it.
      const others = (await tx.channel.findMany({ where: { tenantId: ctx.tenantId, type: 'WHATSAPP', status: 'ACTIVE', id: { not: id } }, select: { config: true } })).filter((o) => { const c = (o.config ?? {}) as { mode?: string; wabaId?: string }; return c.mode === 'platform' && c.wabaId === cfg.wabaId; });
      return others.length === 0 ? cfg.wabaId : null;
    });
    if (toUnsubscribe) {
      // Best effort: a failure here (token already revoked, Meta down) must never stop the disconnect.
      try { const { creds } = await this.credentialsFor(ctx.tenantId, id, ctx.userId); await this.wa.unsubscribeApp(toUnsubscribe, creds.accessToken); }
      catch (e) { new Logger('Channels').warn(`Could not unsubscribe the app from a WhatsApp account on disconnect: ${e instanceof Error ? e.message : 'unknown error'}`); }
    }
  }

  /** Decrypts credentials for server-side use. Callers must never log or return the result. */
  async credentialsFor(tenantId: string, channelId: string, userId?: string | null): Promise<{ channel: { id: string; externalId: string | null; credentialId: string | null; status: string; config: unknown }; creds: WaCredentials }> {
    return this.db.tenantTx({ tenantId, ...(userId ? { userId } : {}) }, async (tx) => {
      const channel = await tx.channel.findFirst({ where: { id: channelId, tenantId, type: 'WHATSAPP' } });
      if (!channel?.credentialId) throw new NotFoundException({ code: 'not_found', message: 'Channel not found' });
      const c = await tx.integrationCredential.findUniqueOrThrow({ where: { id: channel.credentialId } });
      const secret = await this.box.open({ ciphertext: c.ciphertext, wrappedKey: c.wrappedKey, keyId: c.keyId }, this.aad(tenantId, 'whatsapp'));
      // Platform (Embedded Signup) channels carry only a token; the app secret is the platform's own and lives in the environment.
      const platform = (channel.config as { mode?: string } | null)?.mode === 'platform';
      return { channel, creds: { accessToken: secret.accessToken as string, appSecret: platform ? (this.env.META_APP_SECRET ?? '') : (secret.appSecret as string) } };
    });
  }

  // ---- WhatsApp templates (names of templates already approved in Meta; a sync/manager UI is V1.1)
  listTemplates(ctx: TenantRequestContext) { return this.db.tenantTx(ctx, (tx) => tx.whatsappTemplate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } })); }

  /**
   * Read-only sync of the message templates of the workspace's Facebook-connected WhatsApp account(s) (ADR 0012). Templates typed in by hand are
   * never overwritten (a name clash is reported); synced ones are updated with Meta's approval status; synced ones Meta no longer lists are
   * removed. Only APPROVED synced templates can be sent. UNVERIFIED against Meta (`GET /{waba}/message_templates`).
   */
  async syncTemplates(ctx: TenantRequestContext) {
    const channels = await this.db.tenantTx(ctx, (tx) => tx.channel.findMany({ where: { tenantId: ctx.tenantId, type: 'WHATSAPP', status: 'ACTIVE' }, select: { id: true, config: true } }));
    const byWaba = new Map<string, string>(); // waba id -> a channel id whose token can read it
    for (const c of channels) { const cfg = (c.config ?? {}) as { mode?: string; wabaId?: string }; if (cfg.mode === 'platform' && cfg.wabaId && !byWaba.has(cfg.wabaId)) byWaba.set(cfg.wabaId, c.id); }
    if (byWaba.size === 0) throw new BadRequestException({ code: 'no_platform_channel', message: 'Template sync works for WhatsApp numbers connected with Facebook. Connect one first, or add templates by hand.' });
    const fetched: import('../whatsapp/whatsapp.client.js').WaTemplateInfo[] = [];
    for (const [waba, channelId] of byWaba) {
      const { creds } = await this.credentialsFor(ctx.tenantId, channelId, ctx.userId);
      try { fetched.push(...(await this.wa.listTemplates(waba, creds.accessToken))); }
      catch (e) { throw new BadRequestException({ code: 'template_sync_failed', message: e instanceof WhatsAppApiError ? `WhatsApp could not list your templates: ${e.message}` : 'Could not reach WhatsApp to list your templates' }); }
    }
    return this.db.tenantTx(ctx, async (tx) => {
      const existing = await tx.whatsappTemplate.findMany({ where: { tenantId: ctx.tenantId } });
      const key = (n: string, l: string) => `${n}\u0000${l}`; const have = new Map(existing.map((t) => [key(t.name, t.language), t]));
      const seen = new Set<string>(); const now = new Date(); const clashes: string[] = []; let added = 0; let updated = 0;
      for (const t of fetched) {
        const k = key(t.name, t.language); seen.add(k); const row = have.get(k);
        const data = { category: t.category, bodyPreview: t.bodyText || '(no text)', variableCount: (t.bodyText.match(/\{\{\d+\}\}/g) ?? []).length, approvalStatus: t.status, syncedAt: now };
        if (!row) { await tx.whatsappTemplate.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, name: t.name, language: t.language, source: 'meta', ...data } }); added++; }
        else if (row.source !== 'meta') clashes.push(`${t.name} (${t.language})`); // typed in by the workspace: theirs wins
        else { await tx.whatsappTemplate.update({ where: { id: row.id }, data }); updated++; }
      }
      const gone = existing.filter((t) => t.source === 'meta' && !seen.has(key(t.name, t.language))).map((t) => t.id);
      if (gone.length) await tx.whatsappTemplate.deleteMany({ where: { id: { in: gone }, tenantId: ctx.tenantId } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'integration.whatsapp_templates_synced', resourceType: 'channel', resourceId: [...byWaba.values()][0] as string, metadata: { added, updated, removed: gone.length, clashes: clashes.length }, requestId: ctx.requestId, ip: ctx.ip });
      return { accounts: byWaba.size, added, updated, removed: gone.length, clashes, total: fetched.length };
    });
  }
  addTemplate(ctx: TenantRequestContext, i: z.infer<typeof templateSchema>) {
    return this.db.tenantTx(ctx, async (tx) => {
      try { return await tx.whatsappTemplate.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, name: i.name, language: i.language, category: i.category, bodyPreview: i.bodyPreview, variableCount: (i.bodyPreview.match(/\{\{\d+\}\}/g) ?? []).length } }); }
      catch { throw new ConflictException({ code: 'duplicate_template', message: 'That template already exists' }); }
    });
  }
  removeTemplate(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => { const r = await tx.whatsappTemplate.deleteMany({ where: { id, tenantId: ctx.tenantId } }); if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'Template not found' }); });
  }

  // ---- website widget
  async widgetConfig(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const w = await tx.widgetConfig.findUnique({ where: { tenantId: ctx.tenantId } });
      return w ? this.widgetView(w) : null;
    });
  }

  private widgetView(w: { publicKey: string; allowedOrigins: string[]; enabled: boolean; theme: unknown; title: string; greeting: string }) {
    return { publicKey: w.publicKey, allowedOrigins: w.allowedOrigins, enabled: w.enabled, theme: w.theme as { color?: string; position?: string }, title: w.title, greeting: w.greeting, scriptUrl: `${this.apiBase()}/widget.js` };
  }

  saveWidget(ctx: TenantRequestContext, input: z.infer<typeof widgetConfigSchema>) {
    return this.db.tenantTx(ctx, async (tx) => {
      const existing = await tx.widgetConfig.findUnique({ where: { tenantId: ctx.tenantId } });
      const origins = [...new Set(input.allowedOrigins.map((o) => new URL(o).origin))];
      const data = { allowedOrigins: origins, enabled: input.enabled, theme: { color: input.color, position: input.position }, title: input.title, greeting: input.greeting };
      if (existing) { const w = await tx.widgetConfig.update({ where: { tenantId: ctx.tenantId }, data }); await this.rec(ctx, tx, 'integration.widget_updated', w.channelId); return this.widgetView(w); }
      const channelId = uuidv7();
      await tx.channel.create({ data: { id: channelId, tenantId: ctx.tenantId, type: 'WEB_WIDGET', name: 'Website chat' } });
      const w = await tx.widgetConfig.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, channelId, publicKey: `pk_${randomBytes(18).toString('base64url')}`, ...data } });
      await this.rec(ctx, tx, 'integration.widget_created', channelId);
      return this.widgetView(w);
    });
  }

  async rotateWidgetKey(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const w = await tx.widgetConfig.findUnique({ where: { tenantId: ctx.tenantId } });
      if (!w) throw new NotFoundException({ code: 'not_found', message: 'Widget is not set up yet' });
      const u = await tx.widgetConfig.update({ where: { tenantId: ctx.tenantId }, data: { publicKey: `pk_${randomBytes(18).toString('base64url')}` } });
      await this.rec(ctx, tx, 'integration.widget_key_rotated', w.channelId);
      return this.widgetView(u);
    });
  }
}

@Controller()
class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly svc: ChannelsService) {}
  @Get('channels') @RequirePermissions('integration:manage') list(@CurrentTenant() c: TenantRequestContext) { return this.svc.list(c); }
  @Post('channels/whatsapp') @HttpCode(201) @RequirePermissions('integration:manage')
  connect(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(channelWhatsappSchema)) b: WhatsappInput) { return this.svc.connectWhatsapp(c, b); }
  @Get('channels/embedded-signup') @RequirePermissions('integration:manage') embeddedConfig() { return this.svc.embeddedConfig(); }
  @Post('channels/whatsapp/embedded') @HttpCode(201) @Throttle(EMBEDDED_THROTTLE) @RequirePermissions('integration:manage')
  connectEmbedded(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(channelEmbeddedSchema)) b: EmbeddedInput) { return this.svc.connectEmbedded(c, b); }
  @Post('channels/:id/test') @HttpCode(200) @RequirePermissions('integration:manage')
  test(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.test(c, id); }
  @Put('channels/:id/credentials') @HttpCode(204) @RequirePermissions('integration:manage')
  creds(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(channelWhatsappSchema.pick({ accessToken: true, appSecret: true }))) b: { accessToken: string; appSecret: string }) { return this.svc.updateCredentials(c, id, b); }
  @Delete('channels/:id') @HttpCode(204) @RequirePermissions('integration:manage')
  disable(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.disable(c, id); }

  @Get('whatsapp/templates') @RequirePermissions('conversation:reply') templates(@CurrentTenant() c: TenantRequestContext) { return this.svc.listTemplates(c); }
  @Post('whatsapp/templates/sync') @HttpCode(200) @RequirePermissions('integration:manage') syncTemplates(@CurrentTenant() c: TenantRequestContext) { return this.svc.syncTemplates(c); }
  @Post('whatsapp/templates') @HttpCode(201) @RequirePermissions('integration:manage') addTemplate(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(templateSchema)) b: z.infer<typeof templateSchema>) { return this.svc.addTemplate(c, b); }
  @Delete('whatsapp/templates/:id') @HttpCode(204) @RequirePermissions('integration:manage') rmTemplate(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.removeTemplate(c, id); }

  @Get('widget-config') @RequirePermissions('integration:manage') widget(@CurrentTenant() c: TenantRequestContext) { return this.svc.widgetConfig(c); }
  @Put('widget-config') @RequireFeature('web_widget') @RequirePermissions('integration:manage') saveWidget(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(widgetConfigSchema)) b: z.infer<typeof widgetConfigSchema>) { return this.svc.saveWidget(c, b); }
  @Post('widget-config/rotate-key') @HttpCode(200) @RequireFeature('web_widget') @RequirePermissions('integration:manage') rotate(@CurrentTenant() c: TenantRequestContext) { return this.svc.rotateWidgetKey(c); }
}

import { MetaSocialClient } from './meta-social.client.js';
import { MetaSocialAdminController } from './meta-social.controller.js';

@Module({
  imports: [LeadsModule],
  controllers: [ChannelsController, MetaCallbacksController, TelephonyController, MetaSocialAdminController],
  providers: [ChannelsService, TelephonyService, MetaSocialClient],
  exports: [ChannelsService, TelephonyService, MetaSocialClient],
})
export class ChannelsModule {}
