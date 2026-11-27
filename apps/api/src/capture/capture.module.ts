import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { apiKeyCreateSchema, captureLeadSchema, type ApiKeyCreateInput, type CaptureLeadInput } from '@leadpilot/validation';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { AuditService } from '../audit/audit.service.js';
import { hashToken } from '../auth/crypto.js';
import type { Actor } from '../common/actor.js';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators.js';
import type { AppRequest, TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { normalizeEmail, normalizePhone } from '../common/phone.js';

const KEY_PREFIX = 'lp_live_';

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService, @Inject(EntitlementsService) private readonly ent: EntitlementsService) {}

  list(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, (tx) => tx.apiKey.findMany({ where: { tenantId: ctx.tenantId, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, createdAt: true, expiresAt: true, requestCount: true } }).then((rows) => rows.map((r) => ({ ...r, requestCount: Number(r.requestCount) }))));
  }

  /** The plaintext key is returned exactly once. Only its SHA-256 hash is stored. */
  async create(ctx: TenantRequestContext, input: ApiKeyCreateInput) {
    // Keys for the versioned public API need a plan that includes it; the original lead-capture key does not.
    if (input.scopes.some((x) => x !== 'leads:create')) await this.ent.assertFeature(ctx.tenantId, 'api_access');
    const { name } = input;
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    return this.db.tenantTx(ctx, async (tx) => {
      const row = await tx.apiKey.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, name, keyPrefix: key.slice(0, 12), keyHash: hashToken(key), scopes: input.scopes, expiresAt, createdBy: ctx.userId } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'integration.api_key_created', resourceType: 'api_key', resourceId: row.id, metadata: { name, scopes: input.scopes, expiresAt: expiresAt?.toISOString() ?? null }, requestId: ctx.requestId, ip: ctx.ip });
      return { id: row.id, name, key, keyPrefix: row.keyPrefix, scopes: row.scopes, expiresAt: row.expiresAt };
    });
  }

  revoke(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const r = await tx.apiKey.updateMany({ where: { id, tenantId: ctx.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'API key not found' });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'integration.api_key_revoked', resourceType: 'api_key', resourceId: id, requestId: ctx.requestId, ip: ctx.ip });
    });
  }
}

@Injectable()
export class CaptureService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(LeadsService) private readonly leads: LeadsService) {}

  async capture(rawKey: string | undefined, input: CaptureLeadInput, meta: { ip: string | undefined; requestId: string }) {
    const invalid = new UnauthorizedException({ code: 'invalid_api_key', message: 'Invalid API key' });
    if (!rawKey || !rawKey.startsWith(KEY_PREFIX) || rawKey.length > 100) throw invalid;
    const found = await this.db.userTx(null, (tx) => tx.$queryRaw<{ id: string; tenant_id: string; scopes: string[]; revoked_at: Date | null; expires_at: Date | null }[]>`SELECT * FROM find_api_key_by_hash(${hashToken(rawKey)})`);
    const key = found[0];
    if (!key || key.revoked_at || (key.expires_at && key.expires_at <= new Date()) || !key.scopes.includes('leads:create')) throw invalid;
    // Machine actor: may create/assign leads in its own tenant, nothing else.
    const actor: Actor = { tenantId: key.tenant_id, userId: null, membershipId: null, permissions: new Set(['lead:write:all', 'lead:assign']), requestId: meta.requestId, ip: meta.ip, apiKeyId: key.id };
    return this.db.tenantTx({ tenantId: key.tenant_id }, async (tx) => {
      await tx.apiKey.updateMany({ where: { id: key.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - 60_000) } }] }, data: { lastUsedAt: new Date() } });
      const dupes = await this.leads.findDuplicates(tx, key.tenant_id, normalizePhone(input.phone)?.norm ?? null, normalizeEmail(input.email));
      if (dupes[0]) {
        // A returning enquirer must not create a second lead: record the new enquiry on the existing one.
        await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: key.tenant_id, leadId: dupes[0].id, type: 'enquiry_received', data: { via: 'api', ...(input.message ? { message: input.message.slice(0, 500) } : {}) } } });
        return { id: dupes[0].id, duplicate: true };
      }
      const { lead } = await this.leads.createInTx(tx, actor, {
        name: input.name, phone: input.phone ?? null, email: input.email ?? null, requirements: input.message ?? null, location: input.location ?? null,
        propertyType: input.propertyType ?? null, budgetMin: input.budgetMin ?? null, budgetMax: input.budgetMax ?? null, ...(input.source ? { sourceKey: input.source } : {}),
      }, { defaultSource: 'api' });
      return { id: lead.id, duplicate: false };
    });
  }
}

@Controller('api-keys')
class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly keys: ApiKeysService) {}
  @Get() @RequirePermissions('integration:manage') list(@CurrentTenant() ctx: TenantRequestContext) { return this.keys.list(ctx); }
  @Post() @HttpCode(201) @RequirePermissions('integration:manage')
  create(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(apiKeyCreateSchema)) b: ApiKeyCreateInput) { return this.keys.create(ctx, b); }
  @Delete(':id') @HttpCode(204) @RequirePermissions('integration:manage')
  revoke(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.keys.revoke(ctx, id); }
}

/**
 * Server-to-server lead capture. The API key is a secret: call this from a backend (website form handler, Zapier, ad-platform
 * webhook), never from browser code. Browser capture uses the website widget's public key (phase 3).
 */
@Controller('public')
class CaptureController {
  constructor(@Inject(CaptureService) private readonly capture: CaptureService) {}
  @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @Post('leads') @HttpCode(201)
  create(@Headers('x-api-key') key: string | undefined, @Body(new ZodPipe(captureLeadSchema)) body: CaptureLeadInput, @Req() req: AppRequest) {
    return this.capture.capture(key, body, { ip: req.ip, requestId: req.requestId });
  }
}

import { OpsModule } from '../ops/ops.module.js';
import { MetaLeadAdsController } from './meta-lead-ads.controller.js';
import { MetaLeadAdsService } from './meta-lead-ads.service.js';
import { PortalEmailAdminController, PortalEmailWebhookController } from './portal-email/portal-email.controller.js';
import { PortalEmailService } from './portal-email/portal-email.service.js';

@Module({
  imports: [LeadsModule, OpsModule],
  controllers: [ApiKeysController, CaptureController, MetaLeadAdsController, PortalEmailWebhookController, PortalEmailAdminController],
  providers: [ApiKeysService, CaptureService, MetaLeadAdsService, PortalEmailService],
  exports: [MetaLeadAdsService, PortalEmailService],
})
export class CaptureModule {}
