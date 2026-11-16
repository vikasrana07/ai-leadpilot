import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { WEBHOOK_EVENTS, webhookEndpointSchema, webhookEndpointUpdateSchema, type WebhookEndpointInput } from '@leadpilot/validation';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { RequireFeature } from '../common/billing-meta.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolvePublicTarget, UnsafeTargetError } from '../common/safe-http.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SecretBox } from '../crypto/secret-box.js';
import { DbService } from '../db/db.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { WebhookDispatcher, webhookAad } from '../ops/webhook-dispatcher.js';

const MAX_ENDPOINTS = 10;
const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;
type EndpointRow = { id: string; url: string; description: string | null; events: string[]; enabled: boolean; disabledReason: string | null; consecutiveFailures: number; secretPrefix: string; createdAt: Date };
const view = (e: EndpointRow) => ({ id: e.id, url: e.url, description: e.description, events: e.events, enabled: e.enabled, disabledReason: e.disabledReason, consecutiveFailures: e.consecutiveFailures, secretPrefix: e.secretPrefix, createdAt: e.createdAt.toISOString() });

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService, @Inject(SecretBox) private readonly secrets: SecretBox,
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher, @Inject(ENV) private readonly env: Env,
  ) {}

  /** Refuses private/loopback/link-local targets and plain http at configuration time too (they are re-checked at every send). */
  private async validateUrl(url: string): Promise<void> {
    try { await resolvePublicTarget(url, { allowPrivate: this.env.WEBHOOK_ALLOW_PRIVATE_TARGETS }); }
    catch (e) { if (e instanceof UnsafeTargetError) throw new BadRequestException({ code: 'unsafe_webhook_url', message: e.message }); throw e; }
  }

  async list(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const rows = await tx.webhookEndpoint.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'asc' } });
      const out = [];
      for (const e of rows) {
        const last = await tx.webhookDelivery.findFirst({ where: { endpointId: e.id, test: false }, orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true, lastStatusCode: true } });
        const counts = await tx.webhookDelivery.groupBy({ by: ['status'], where: { endpointId: e.id, createdAt: { gt: new Date(Date.now() - 7 * 864e5) } }, _count: { _all: true } });
        out.push({ ...view(e), lastDelivery: last ? { status: last.status, at: last.createdAt.toISOString(), statusCode: last.lastStatusCode } : null, last7d: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) });
      }
      return out;
    });
  }

  async create(ctx: TenantRequestContext, input: WebhookEndpointInput) {
    await this.validateUrl(input.url);
    const secret = newSecret();
    return this.db.tenantTx(ctx, async (tx) => {
      if ((await tx.webhookEndpoint.count({ where: { tenantId: ctx.tenantId } })) >= MAX_ENDPOINTS) throw new ConflictException({ code: 'too_many_endpoints', message: `You can have up to ${MAX_ENDPOINTS} webhook endpoints` });
      const id = crypto.randomUUID();
      const sealed = await this.secrets.seal({ secret }, webhookAad(ctx.tenantId, id));
      const row = await tx.webhookEndpoint.create({ data: { id, tenantId: ctx.tenantId, url: input.url, description: input.description ?? null, events: input.events, secretPrefix: secret.slice(0, 12), secretCiphertext: sealed.ciphertext, secretWrappedKey: sealed.wrappedKey, secretKeyId: sealed.keyId, createdBy: ctx.userId } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'webhook.endpoint_created', resourceType: 'webhook_endpoint', resourceId: id, metadata: { host: new URL(input.url).host, events: input.events }, requestId: ctx.requestId, ip: ctx.ip });
      return { ...view(row), secret };
    });
  }

  async update(ctx: TenantRequestContext, id: string, input: z.infer<typeof webhookEndpointUpdateSchema>) {
    if (input.url) await this.validateUrl(input.url);
    return this.db.tenantTx(ctx, async (tx) => {
      const cur = await tx.webhookEndpoint.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Webhook endpoint not found' });
      const row = await tx.webhookEndpoint.update({ where: { id }, data: {
        ...(input.url ? { url: input.url } : {}), ...(input.events ? { events: input.events } : {}), ...(input.description !== undefined ? { description: input.description } : {}),
        // Switching back on clears the failure history so the endpoint gets a fair chance.
        ...(input.enabled === true ? { enabled: true, disabledReason: null, consecutiveFailures: 0 } : input.enabled === false ? { enabled: false, disabledReason: 'Switched off by a team member' } : {}),
      } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'webhook.endpoint_updated', resourceType: 'webhook_endpoint', resourceId: id, metadata: { fields: Object.keys(input) }, requestId: ctx.requestId, ip: ctx.ip });
      return view(row);
    });
  }

  async remove(ctx: TenantRequestContext, id: string): Promise<void> {
    await this.db.tenantTx(ctx, async (tx) => {
      const r = await tx.webhookEndpoint.deleteMany({ where: { id, tenantId: ctx.tenantId } });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'Webhook endpoint not found' });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'webhook.endpoint_deleted', resourceType: 'webhook_endpoint', resourceId: id, requestId: ctx.requestId, ip: ctx.ip });
    });
  }

  /** The new secret is shown once; the old one stops working immediately. */
  async rotate(ctx: TenantRequestContext, id: string) {
    const secret = newSecret();
    return this.db.tenantTx(ctx, async (tx) => {
      const cur = await tx.webhookEndpoint.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Webhook endpoint not found' });
      const sealed = await this.secrets.seal({ secret }, webhookAad(ctx.tenantId, id));
      await tx.webhookEndpoint.update({ where: { id }, data: { secretPrefix: secret.slice(0, 12), secretCiphertext: sealed.ciphertext, secretWrappedKey: sealed.wrappedKey, secretKeyId: sealed.keyId } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'webhook.secret_rotated', resourceType: 'webhook_endpoint', resourceId: id, requestId: ctx.requestId, ip: ctx.ip });
      return { secret, secretPrefix: secret.slice(0, 12) };
    });
  }

  async test(ctx: TenantRequestContext, id: string) {
    const ep = await this.db.tenantTx(ctx, (tx) => tx.webhookEndpoint.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } }));
    if (!ep) throw new NotFoundException({ code: 'not_found', message: 'Webhook endpoint not found' });
    const { deliveryId } = await this.dispatcher.sendTest(ctx.tenantId, id);
    return this.delivery(ctx, deliveryId);
  }

  async deliveries(ctx: TenantRequestContext, endpointId: string, limit: number) {
    return this.db.tenantTx(ctx, async (tx) => {
      if (!(await tx.webhookEndpoint.findFirst({ where: { id: endpointId, tenantId: ctx.tenantId }, select: { id: true } }))) throw new NotFoundException({ code: 'not_found', message: 'Webhook endpoint not found' });
      const rows = await tx.webhookDelivery.findMany({ where: { endpointId, tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: limit });
      return rows.map((d) => ({ id: d.id, eventType: d.eventType, eventId: d.eventId, test: d.test, status: d.status, attempts: d.attempts, statusCode: d.lastStatusCode, latencyMs: d.lastLatencyMs, error: d.lastError, createdAt: d.createdAt.toISOString(), deliveredAt: d.deliveredAt?.toISOString() ?? null, nextAttemptAt: d.status === 'PENDING' ? d.nextAttemptAt.toISOString() : null }));
    });
  }

  /** Exactly what was sent (the payload), for debugging. */
  async delivery(ctx: TenantRequestContext, id: string) {
    const d = await this.db.tenantTx(ctx, (tx) => tx.webhookDelivery.findFirst({ where: { id, tenantId: ctx.tenantId } }));
    if (!d) throw new NotFoundException({ code: 'not_found', message: 'Delivery not found' });
    return { id: d.id, endpointId: d.endpointId, eventType: d.eventType, test: d.test, status: d.status, attempts: d.attempts, statusCode: d.lastStatusCode, latencyMs: d.lastLatencyMs, error: d.lastError, createdAt: d.createdAt.toISOString(), deliveredAt: d.deliveredAt?.toISOString() ?? null, payload: d.payload };
  }

  async redeliver(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const d = await tx.webhookDelivery.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { endpoint: { select: { enabled: true } } } });
      if (!d) throw new NotFoundException({ code: 'not_found', message: 'Delivery not found' });
      if (!d.endpoint.enabled) throw new ConflictException({ code: 'endpoint_disabled', message: 'Switch the endpoint back on before redelivering' });
      if (d.status === 'PENDING' || d.status === 'SENDING') throw new ConflictException({ code: 'in_progress', message: 'This delivery is still being attempted' });
      await tx.webhookDelivery.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'webhook.redelivered', resourceType: 'webhook_delivery', resourceId: id, requestId: ctx.requestId, ip: ctx.ip });
      return { queued: true };
    });
  }
}

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Configuration of outbound webhooks. Needs a plan with API access (402 otherwise) and the integrations permission. */
@Controller('webhooks') @RequireFeature('api_access') @RequirePermissions('integration:manage')
class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly svc: WebhooksService) {}
  @Get('events') events() { return { events: WEBHOOK_EVENTS }; }
  @Get('endpoints') list(@CurrentTenant() c: TenantRequestContext) { return this.svc.list(c); }
  @Post('endpoints') @HttpCode(201) create(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(webhookEndpointSchema)) b: WebhookEndpointInput) { return this.svc.create(c, b); }
  @Patch('endpoints/:id') update(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(webhookEndpointUpdateSchema)) b: z.infer<typeof webhookEndpointUpdateSchema>) { return this.svc.update(c, id, b); }
  @Delete('endpoints/:id') @HttpCode(204) remove(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.remove(c, id); }
  @Post('endpoints/:id/rotate-secret') @HttpCode(200) rotate(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.rotate(c, id); }
  @Post('endpoints/:id/test') @HttpCode(200) test(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.test(c, id); }
  @Get('endpoints/:id/deliveries') deliveries(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.svc.deliveries(c, id, q.limit); }
  @Get('deliveries/:id') delivery(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.delivery(c, id); }
  @Post('deliveries/:id/redeliver') @HttpCode(200) redeliver(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.redeliver(c, id); }
}

@Module({ imports: [OpsModule], controllers: [WebhooksController], providers: [WebhooksService] })
export class WebhooksModule {}
