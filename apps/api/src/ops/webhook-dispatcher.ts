import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { createHmac } from 'node:crypto';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { safePost, resolvePublicTarget, UnsafeTargetError } from '../common/safe-http.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { SecretBox } from '../crypto/secret-box.js';
import { DbService } from '../db/db.module.js';
import { metrics } from '../observability/metrics.js';
import { BillingNotifier } from './billing-notify.js';
import type { DomainEvent } from './automation-engine.js';

/** What the receiver gets. Event payloads carry ids only (fetch details through the public API), never message text or personal fields. */
export interface WebhookEnvelope { id: string; type: string; createdAt: string; test: boolean; data: Record<string, unknown> }
export const webhookAad = (tenantId: string, endpointId: string) => `${tenantId}:webhook:${endpointId}`;
export function sign(secret: string, timestamp: number, body: string): string { return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`; }

interface Claimed { id: string; tenant_id: string; endpoint_id: string; event_type: string; payload: WebhookEnvelope; attempts: number; test: boolean }

/**
 * Outbound webhooks on top of the transactional outbox. The relay calls `enqueue` inside its per-event transaction (so a delivery row
 * exists exactly when the event was processed, once per endpoint); `drainOnce` claims due deliveries (SKIP LOCKED, 2-minute lease, any number of
 * workers), POSTs a signed body through the SSRF-safe client and records the outcome. Retries back off; exhausted deliveries become FAILED and
 * repeated failures switch the endpoint off and tell the owners.
 */
@Injectable()
export class WebhookDispatcher {
  private readonly log = new Logger('Webhooks');
  /** Hooked by JobsService so redeliveries or events reach BullMQ workers. */
  enqueueJob: (tenantId: string, deliveryId: string, generation?: number) => Promise<void> = async () => undefined;

  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env, @Inject(SecretBox) private readonly secrets: SecretBox,
    @Inject(BillingNotifier) private readonly notifier: BillingNotifier, @Inject(EntitlementsService) private readonly ent: EntitlementsService,
  ) {}

  /** Inside the relay transaction. Returns the IDs of deliveries created. */
  async enqueue(tx: TxClient, ev: DomainEvent): Promise<string[]> {
    const endpoints = await tx.webhookEndpoint.findMany({ where: { tenantId: ev.tenantId, enabled: true, events: { has: ev.type } }, select: { id: true } });
    if (endpoints.length === 0) return [];
    const plan = await this.ent.compute(tx, ev.tenantId);
    if (!plan.features.api_access || plan.restricted) return [];
    const { depth: _d, originAutomationId: _o, ...data } = ev.payload as Record<string, unknown>;
    const envelope: WebhookEnvelope = { id: ev.id, type: ev.type, createdAt: new Date().toISOString(), test: false, data };
    const deliveryIds: string[] = [];
    for (const e of endpoints) {
      const d = await tx.webhookDelivery.create({
        data: {
          tenantId: ev.tenantId,
          endpointId: e.id,
          eventId: ev.id,
          eventType: ev.type,
          payload: envelope as unknown as Prisma.InputJsonObject,
        },
      });
      deliveryIds.push(d.id);
    }
    return deliveryIds;
  }

  async drainOnce(limit = 20): Promise<number> {
    const rows = await this.db.prisma.$queryRaw<Claimed[]>`SELECT id, tenant_id, endpoint_id, event_type, payload, attempts, test FROM claim_webhook_deliveries(${limit})`;
    // Different endpoints in parallel (one slow receiver must not stall the rest); deliveries to the same endpoint stay ordered by claim.
    await Promise.all(rows.map((r) => this.deliver(r).catch((e: unknown) => this.log.error(`delivery ${r.id} crashed: ${e instanceof Error ? e.message : String(e)}`))));
    return rows.length;
  }

  /** Sends one test event immediately and returns the recorded outcome (used by the "Send test event" action). */
  async sendTest(tenantId: string, endpointId: string): Promise<{ deliveryId: string }> {
    const deliveryId = await this.db.tenantTx({ tenantId }, async (tx) => {
      const eventId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const envelope: WebhookEnvelope = { id: eventId, type: 'webhook.test', createdAt: new Date().toISOString(), test: true, data: { message: 'This is a test event from LeadPilot.' } };
      const d = await tx.webhookDelivery.create({ data: { tenantId, endpointId, eventId, eventType: 'webhook.test', test: true, payload: envelope as unknown as Prisma.InputJsonObject, status: 'SENDING', attempts: 1 } });
      return d.id;
    });
    const d = await this.db.tenantTx({ tenantId }, (tx) => tx.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } }));
    await this.deliver({ id: d.id, tenant_id: tenantId, endpoint_id: endpointId, event_type: d.eventType, payload: d.payload as unknown as WebhookEnvelope, attempts: 1, test: true });
    return { deliveryId };
  }

  /**
   * BullMQ worker handler for outgoing webhook deliveries.
   * Dispatches via SSRF-safe client, updates status in DB, and on exhaustion records DLQ entry (status: FAILED).
   */
  async deliverJob(deliveryId: string, tenantId: string, attempt: number, maxAttempts: number): Promise<void> {
    const row = await this.db.tenantTx({ tenantId }, (tx) => tx.webhookDelivery.findUnique({ where: { id: deliveryId } }));
    if (!row) return;
    if (row.status === 'SUCCEEDED') return; // Idempotent: already succeeded

    await this.deliver({
      id: row.id,
      tenant_id: row.tenantId,
      endpoint_id: row.endpointId,
      event_type: row.eventType,
      payload: row.payload as unknown as WebhookEnvelope,
      attempts: attempt,
      test: row.test,
    }, maxAttempts);
  }

  private backoffMs(attempt: number): number { return Math.min(6 * 3600_000, this.env.WEBHOOK_BACKOFF_BASE_MS * 4 ** Math.max(0, attempt - 1)); }

  private async deliver(row: Claimed, customMaxAttempts?: number): Promise<void> {
    const tenantId = row.tenant_id;
    const ep = await this.db.tenantTx({ tenantId }, (tx) => tx.webhookEndpoint.findUnique({ where: { id: row.endpoint_id } }));
    if (!ep || !ep.enabled) {
      await this.db.tenantTx({ tenantId }, (tx) => tx.webhookDelivery.updateMany({ where: { id: row.id }, data: { status: 'FAILED', lastError: 'Endpoint is disabled or was removed' } }));
      return;
    }
    const secret = (await this.secrets.open({ ciphertext: ep.secretCiphertext, wrappedKey: ep.secretWrappedKey, keyId: ep.secretKeyId }, webhookAad(tenantId, ep.id))).secret as string;
    const body = JSON.stringify(row.payload);
    const ts = Math.floor(Date.now() / 1000);
    let status: number | null = null; let latency: number | null = null; let error: string | null = null; let terminal = false;
    try {
      const target = await resolvePublicTarget(ep.url, { allowPrivate: this.env.WEBHOOK_ALLOW_PRIVATE_TARGETS });
      const res = await safePost(target, body, {
        'content-type': 'application/json', 'user-agent': 'LeadPilot-Webhooks/1.0', 'x-leadpilot-event': row.event_type, 'x-leadpilot-delivery': row.id, 'x-leadpilot-timestamp': String(ts), 'x-leadpilot-signature': sign(secret, ts, body),
      }, { timeoutMs: this.env.WEBHOOK_TIMEOUT_MS });
      status = res.status; latency = res.latencyMs;
      if (res.status < 200 || res.status >= 300) error = res.status >= 300 && res.status < 400 ? `Redirects are not followed (HTTP ${res.status})` : `Receiver answered HTTP ${res.status}`;
    } catch (e) {
      if (e instanceof UnsafeTargetError) { error = `Blocked: ${e.message}`; terminal = true; }
      else error = e instanceof Error && /timeout/i.test(e.message) ? 'Timed out' : 'Could not connect to the receiver';
    }

    let disabledNow = false;
    const maxAttempts = customMaxAttempts ?? this.env.WEBHOOK_MAX_ATTEMPTS;
    await this.db.tenantTx({ tenantId }, async (tx) => {
      if (!error) {
        metrics.job('webhook', 'ok');
        await tx.webhookDelivery.update({ where: { id: row.id }, data: { status: 'SUCCEEDED', deliveredAt: new Date(), attempts: row.attempts, lastStatusCode: status, lastLatencyMs: latency, lastError: null } });
        await tx.webhookEndpoint.updateMany({ where: { id: ep.id }, data: { consecutiveFailures: 0 } });
        return;
      }
      const exhausted = terminal || row.attempts >= maxAttempts;
      metrics.job('webhook', exhausted ? 'failed' : 'skipped'); // 'skipped' = failed attempt that will be retried
      await tx.webhookDelivery.update({ where: { id: row.id }, data: exhausted
        ? { status: 'FAILED', attempts: row.attempts, lastStatusCode: status, lastLatencyMs: latency, lastError: error }
        : { status: 'PENDING', attempts: row.attempts, nextAttemptAt: new Date(Date.now() + this.backoffMs(row.attempts)), lastStatusCode: status, lastLatencyMs: latency, lastError: error } });
      if (!exhausted || row.test) return;
      const upd = await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { consecutiveFailures: { increment: 1 } }, select: { consecutiveFailures: true } });
      if (upd.consecutiveFailures >= this.env.WEBHOOK_DISABLE_AFTER) {
        await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { enabled: false, disabledReason: `Switched off automatically after ${upd.consecutiveFailures} consecutive failed deliveries` } });
        disabledNow = true;
      }
    });
    if (disabledNow) {
      await this.notifier.notifyOwners(tenantId, { type: 'integration', title: 'A webhook endpoint was switched off', body: `${new URL(ep.url).host} failed ${this.env.WEBHOOK_DISABLE_AFTER} deliveries in a row. Fix the receiver, then re-enable it under Webhooks.`, link: '/webhooks' }, `webhook-disabled:${ep.id}:${Date.now()}`).catch(() => undefined);
    }
    if (error && customMaxAttempts) {
      throw new Error(`Webhook delivery failed: ${error} (status: ${status})`);
    }
  }
}
