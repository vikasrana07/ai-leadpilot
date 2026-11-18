import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ChannelsService } from '../channels/channels.module.js';
import { DbService } from '../db/db.module.js';
import { WHATSAPP_CLIENT, WhatsAppApiError, type WhatsAppClient } from '../whatsapp/whatsapp.client.js';
import { BillingNotifier } from './billing-notify.js';

/** Meta error codes that mean "this token is no longer valid" (invalid or expired OAuth token, session invalidated). Anything else is treated as a passing problem. */
const TOKEN_REVOKED_CODES = new Set([190, 102, 463, 467]);
export const isTokenRevoked = (e: unknown): boolean => e instanceof WhatsAppApiError && !e.retryable && e.code !== undefined && TOKEN_REVOKED_CODES.has(e.code);

const EXPIRY_WARNING_DAYS = 7;
export interface HealthReport { checked: number; recovered: number; needsReconnect: number; transient: number; expiring: number }

/**
 * Once a day, tests the token of every Facebook-connected WhatsApp number (ADR 0012). A token that was revoked (the owner removed LeadPilot
 * in Facebook, the business token expired, a password change invalidated it) cannot be fixed by editing settings: the channel becomes
 * NEEDS_RECONNECT, sends stop with a clear message, and the owners are told once. A passing problem (Meta down, network) changes nothing.
 * The first day check of a channel wins an event mark, so overlapping workers do the side effects once. UNVERIFIED against Meta: the
 * "revoked" error codes follow Meta's documented OAuth errors.
 */
@Injectable()
export class ChannelHealth {
  private readonly log = new Logger('ChannelHealth');
  private doneDay = '';
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(WHATSAPP_CLIENT) private readonly wa: WhatsAppClient, @Inject(BillingNotifier) private readonly notifier: BillingNotifier, @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Called every minute by the maintenance job; does real work once per day per process (and once per channel per day overall). */
  async runDaily(now = new Date()): Promise<HealthReport | null> {
    const day = now.toISOString().slice(0, 10);
    if (this.doneDay === day) return null;
    const report = await this.run(now);
    if (report.transient === 0) this.doneDay = day; // a passing failure is retried on the next tick
    return report;
  }

  async run(now = new Date()): Promise<HealthReport> {
    const day = now.toISOString().slice(0, 10);
    const report: HealthReport = { checked: 0, recovered: 0, needsReconnect: 0, transient: 0, expiring: 0 };
    const rows = await this.db.prisma.$queryRaw<{ id: string; tenant_id: string; status: string }[]>`SELECT id, tenant_id, status FROM list_platform_channels_for_health()`;
    for (const r of rows) {
      try { await this.checkOne(r, day, now, report); }
      catch (e) { report.transient++; this.log.warn(`Health check of a WhatsApp channel failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return report;
  }

  private async checkOne(r: { id: string; tenant_id: string; status: string }, day: string, now: Date, report: HealthReport): Promise<void> {
    const tenantId = r.tenant_id; const markKey = `wa-health:${day}:${r.id}`;
    if (await this.db.tenantTx({ tenantId }, async (tx) => !!(await tx.eventMark.findFirst({ where: { tenantId, key: markKey }, select: { key: true } })))) return; // already checked today
    report.checked++;
    const { channel, creds } = await this.channels.credentialsFor(tenantId, r.id);
    let revoked = false;
    try { await this.wa.getPhoneNumber(channel.externalId ?? '', creds); }
    catch (e) {
      if (!isTokenRevoked(e)) { report.transient++; this.log.warn(`WhatsApp health check could not reach Meta for a channel: ${e instanceof Error ? e.message : 'unknown error'}`); return; } // retried on the next tick
      revoked = true;
    }
    // A definite answer: claim today's mark so another process does not repeat the side effects.
    const first = await this.db.tenantTx({ tenantId }, async (tx) => (await tx.eventMark.createMany({ data: [{ tenantId, key: markKey }], skipDuplicates: true })).count === 1);
    if (!first) return;

    if (revoked) {
      if (r.status === 'NEEDS_RECONNECT') return; // already flagged; the owners were told when it happened
      await this.db.tenantTx({ tenantId }, async (tx) => {
        await tx.channel.update({ where: { id: r.id }, data: { status: 'NEEDS_RECONNECT' } });
        await this.audit.record(tx, { tenantId, actorUserId: null, action: 'integration.whatsapp_needs_reconnect', resourceType: 'channel', resourceId: r.id, metadata: {} });
      });
      report.needsReconnect++;
      await this.notifier.notifyOwners(tenantId, { type: 'integration', title: 'WhatsApp needs to be connected again', body: 'The connection to your WhatsApp number was revoked or has expired, so messages cannot be sent or received. Open Integrations and choose Reconnect with Facebook.', link: '/integrations' }, `wa-needs-reconnect:${r.id}:${day}`);
      return;
    }

    if (r.status !== 'ACTIVE') {
      await this.db.tenantTx({ tenantId }, async (tx) => {
        await tx.channel.update({ where: { id: r.id }, data: { status: 'ACTIVE' } });
        if (channel.credentialId) await tx.integrationCredential.updateMany({ where: { id: channel.credentialId }, data: { lastVerifiedAt: now, status: 'active' } });
        await this.audit.record(tx, { tenantId, actorUserId: null, action: 'integration.whatsapp_recovered', resourceType: 'channel', resourceId: r.id, metadata: {} });
      });
      report.recovered++;
    } else if (channel.credentialId) {
      await this.db.tenantTx({ tenantId }, (tx) => tx.integrationCredential.updateMany({ where: { id: channel.credentialId as string }, data: { lastVerifiedAt: now } }));
    }

    // A token that Meta said would expire is worth a heads-up a week ahead (only when Meta gave an expiry; unknown means no warning).
    const exp = (channel.config as { tokenExpiresAt?: string } | null)?.tokenExpiresAt;
    const left = exp ? (new Date(exp).getTime() - now.getTime()) / 86_400_000 : null;
    if (left !== null && left > 0 && left <= EXPIRY_WARNING_DAYS) {
      report.expiring++;
      await this.notifier.notifyOwners(tenantId, { type: 'integration', title: 'Your WhatsApp connection expires soon', body: `Reconnect with Facebook within ${Math.ceil(left)} day(s) to avoid an interruption.`, link: '/integrations' }, `wa-token-expiring:${r.id}:${day}`);
    }
  }
}
