import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma, TxClient } from '@leadpilot/database';
import { gzipSync } from 'node:zlib';
import { AuditService } from '../audit/audit.service.js';
import { type BillingProvider, BILLING_PROVIDER } from '../billing/provider.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../ai/knowledge/storage.js';
import { BillingNotifier } from './billing-notify.js';
import { EXPORT_INCLUDED } from './export-tables.js';

/** Per-workspace retention, stored in `tenants.settings.retention`. `null` = keep forever. */
export interface RetentionSettings { webhookPayloadDays: number; closedConversationDays: number | null; auditLogDays: number | null; softDeletedLeadDays: number; automationDryRunDays: number; automationRunDays: number; automationVersionDays: number }

export function effectiveRetention(settings: Prisma.JsonValue, env: Pick<Env, 'RETENTION_WEBHOOK_PAYLOAD_DAYS' | 'RETENTION_SOFT_DELETED_LEAD_DAYS' | 'RETENTION_MIN_DAYS' | 'RETENTION_AUTOMATION_DRY_RUN_DAYS' | 'RETENTION_AUTOMATION_RUN_DAYS' | 'RETENTION_AUTOMATION_VERSION_DAYS'>): RetentionSettings {
  const r = ((settings as { retention?: Partial<Record<keyof RetentionSettings, unknown>> } | null)?.retention ?? {});
  const days = (v: unknown, dflt: number | null): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(env.RETENTION_MIN_DAYS, Math.floor(v)) : v === null ? null : dflt === null ? null : Math.max(env.RETENTION_MIN_DAYS, dflt));
  return {
    webhookPayloadDays: days(r.webhookPayloadDays, env.RETENTION_WEBHOOK_PAYLOAD_DAYS) as number,
    closedConversationDays: typeof r.closedConversationDays === 'number' ? days(r.closedConversationDays, null) : null,
    auditLogDays: typeof r.auditLogDays === 'number' ? days(r.auditLogDays, null) : null,
    softDeletedLeadDays: days(r.softDeletedLeadDays, env.RETENTION_SOFT_DELETED_LEAD_DAYS) as number,
    automationDryRunDays: days(r.automationDryRunDays, env.RETENTION_AUTOMATION_DRY_RUN_DAYS) as number,
    automationRunDays: days(r.automationRunDays, env.RETENTION_AUTOMATION_RUN_DAYS) as number,
    automationVersionDays: days(r.automationVersionDays, env.RETENTION_AUTOMATION_VERSION_DAYS) as number,
  };
}

const BATCH = 1000;
const PAGE = 5000;
const DAY = 86_400_000;

/**
 * Time-driven data lifecycle: daily retention purge, asynchronous workspace exports, and the final purge of workspaces whose deletion
 * cooling-off period has ended. Everything destructive runs through narrow SECURITY DEFINER functions and is idempotent.
 */
@Injectable()
export class LifecycleJobs {
  private readonly log = new Logger('Lifecycle');
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef, @Inject(BillingNotifier) private readonly notifier: BillingNotifier,
  ) {}

  // The storage and billing providers live in modules that depend on this one; resolve them lazily instead of importing those modules.
  private storage(): ObjectStorage { return this.moduleRef.get<ObjectStorage>(OBJECT_STORAGE, { strict: false }); }
  private provider(): BillingProvider { return this.moduleRef.get<BillingProvider>(BILLING_PROVIDER, { strict: false }); }

  // ------------------------------------------------------------------ retention
  /** Runs (or previews, with `dry`) the workspace's retention policy. Returns the total rows affected per category. */
  async runRetention(tenantId: string, o: { dry?: boolean; actorUserId?: string | null } = {}): Promise<Record<string, number>> {
    const dry = o.dry ?? false;
    const policy = await this.db.tenantTx({ tenantId }, async (tx) => effectiveRetention((await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings, this.env));
    const totals: Record<string, number> = {};
    for (let i = 0; i < (dry ? 1 : 20); i++) {
      const rows = await this.db.prisma.$queryRaw<{ r: Record<string, number> | null }[]>`SELECT purge_retention(${tenantId}::uuid, ${policy.webhookPayloadDays}::int, ${policy.closedConversationDays}::int, ${policy.auditLogDays}::int, ${policy.softDeletedLeadDays}::int, ${BATCH}::int, ${dry}::boolean) AS r`;
      const r = rows[0]?.r ?? {};
      let batch = 0;
      for (const [k, v] of Object.entries(r)) { totals[k] = (totals[k] ?? 0) + v; if (k !== 'messages') batch += v; }
      if (batch < BATCH) break; // the last batch was not full: nothing left
    }
    // Automation history lives in its own function so the workspace-data purge above keeps its signature. Runs are purged before the versions they pinned.
    for (let i = 0; i < (dry ? 1 : 20); i++) {
      const rows = await this.db.prisma.$queryRaw<{ r: Record<string, number> | null }[]>`SELECT purge_automation_data(${tenantId}::uuid, ${policy.automationDryRunDays}::int, ${policy.automationRunDays}::int, ${policy.automationVersionDays}::int, ${BATCH}::int, ${dry}::boolean) AS r`;
      const r = rows[0]?.r ?? {};
      let batch = 0;
      for (const [k, v] of Object.entries(r)) { totals[k] = (totals[k] ?? 0) + v; batch = Math.max(batch, v); }
      if (batch < BATCH) break;
    }
    const any = Object.values(totals).some((v) => v > 0);
    if (!dry && any) await this.db.tenantTx({ tenantId }, (tx) => this.audit.record(tx, { tenantId, actorUserId: o.actorUserId ?? null, action: 'privacy.retention_purged', resourceType: 'tenant', resourceId: tenantId, metadata: { counts: totals, policy: policy as unknown as Prisma.InputJsonObject } }));
    return totals;
  }

  /** Once per workspace per day (an event mark is the lock, so overlapping workers and ticks cannot run it twice). */
  async retentionTick(tenantId: string, now = new Date()): Promise<Record<string, number> | null> {
    const first = await this.db.tenantTx({ tenantId }, async (tx) => (await tx.eventMark.createMany({ data: [{ tenantId, key: `retention:${now.toISOString().slice(0, 10)}` }], skipDuplicates: true })).count === 1);
    return first ? this.runRetention(tenantId) : null;
  }

  // ------------------------------------------------------------------ workspace export
  async processExports(): Promise<number> {
    const rows = await this.db.prisma.$queryRaw<{ id: string; tenant_id: string }[]>`SELECT id, tenant_id FROM list_pending_exports()`;
    let n = 0;
    for (const r of rows) { if (await this.generateExport(r.tenant_id, r.id)) n++; }
    await this.expireExports();
    return n;
  }

  private async tableJson(tx: TxClient, tenantId: string, table: string, redact: readonly string[]): Promise<unknown[]> {
    // `table` and `redact` come from the constant allow-list in export-tables.ts, never from input.
    const minus = redact.length ? ` - ARRAY[${redact.map((c) => `'${c.replace(/'/g, '')}'`).join(',')}]` : '';
    const out: unknown[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await tx.$queryRawUnsafe<{ r: unknown }[]>(`SELECT (to_jsonb(t)${minus}) AS r FROM "${table}" t WHERE tenant_id = $1::uuid ORDER BY t.ctid LIMIT ${PAGE} OFFSET ${offset}`, tenantId);
      out.push(...page.map((x) => x.r));
      if (page.length < PAGE) break;
    }
    return out;
  }

  /** Builds `workspace-export.json.gz`: one JSON document `{ exportedAt, tenant, members, tables: { <table>: [rows] } }`. Returns false if another worker owns it. */
  async generateExport(tenantId: string, exportId: string): Promise<boolean> {
    const claimed = await this.db.tenantTx({ tenantId }, async (tx) => (await tx.dataExport.updateMany({ where: { id: exportId, OR: [{ status: 'QUEUED' }, { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } }] }, data: { status: 'RUNNING', startedAt: new Date() } })).count === 1);
    if (!claimed) return false;
    try {
      const doc = await this.db.tenantTx({ tenantId }, async (tx) => {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, email: true, phone: true, website: true, address: true, industry: true, timezone: true, currency: true, settings: true, createdAt: true } });
        const members = await tx.$queryRaw<unknown[]>`SELECT u.name, u.email, r.key AS role, m.status, m.created_at AS "joinedAt" FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id WHERE m.tenant_id = ${tenantId}::uuid ORDER BY m.created_at`;
        const tables: Record<string, unknown[]> = {};
        for (const [t, redact] of Object.entries(EXPORT_INCLUDED)) tables[t] = await this.tableJson(tx, tenantId, t, redact);
        return { exportedAt: new Date().toISOString(), format: 'leadpilot-workspace-export/1', note: 'Secrets, credentials and internal queues are not included. Money amounts are in minor units (paise).', tenant, members, tables };
      });
      const body = gzipSync(Buffer.from(JSON.stringify(doc, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))), { level: 6 });
      const key = `tenants/${tenantId}/exports/${exportId}/workspace-export.json.gz`;
      await this.storage().put(key, body, 'application/gzip');
      const expiresAt = new Date(Date.now() + this.env.EXPORT_TTL_DAYS * DAY);
      await this.db.tenantTx({ tenantId }, async (tx) => {
        await tx.dataExport.update({ where: { id: exportId }, data: { status: 'READY', storageKey: key, sizeBytes: BigInt(body.length), completedAt: new Date(), expiresAt, error: null } });
        await this.audit.record(tx, { tenantId, actorUserId: null, action: 'privacy.workspace_export_ready', resourceType: 'data_export', resourceId: exportId, metadata: { bytes: body.length, tables: Object.keys(EXPORT_INCLUDED).length } });
      });
      await this.notifier.notifyOwners(tenantId, { type: 'privacy', title: 'Your workspace export is ready', body: `Download it from Settings within ${this.env.EXPORT_TTL_DAYS} days.`, link: '/settings' }, `export-ready:${exportId}`).catch(() => undefined);
      return true;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      this.log.error(`Export ${exportId} failed: ${msg}`);
      await this.db.tenantTx({ tenantId }, (tx) => tx.dataExport.update({ where: { id: exportId }, data: { status: 'FAILED', error: msg, completedAt: new Date() } })).catch(() => undefined);
      return true;
    }
  }

  async expireExports(): Promise<number> {
    const rows = await this.db.prisma.$queryRaw<{ id: string; tenant_id: string; storage_key: string | null }[]>`SELECT id, tenant_id, storage_key FROM list_expired_exports()`;
    for (const r of rows) {
      try { if (r.storage_key) await this.storage().delete(r.storage_key); } catch (e) { this.log.warn(`Could not delete expired export object: ${e instanceof Error ? e.message : String(e)}`); }
      await this.db.tenantTx({ tenantId: r.tenant_id }, (tx) => tx.dataExport.update({ where: { id: r.id }, data: { status: 'EXPIRED', storageKey: null } }));
    }
    return rows.length;
  }

  // ------------------------------------------------------------------ tenant deletion
  /** Permanently purges every workspace whose cooling-off period has ended. Safe to call repeatedly. */
  async purgeDueTenants(): Promise<string[]> {
    const due = await this.db.prisma.$queryRaw<{ id: string; tenant_id: string }[]>`SELECT id, tenant_id FROM list_due_tenant_deletions()`;
    const purged: string[] = [];
    for (const d of due) { if (await this.purgeTenant(d.tenant_id)) purged.push(d.tenant_id); }
    return purged;
  }

  async purgeTenant(tenantId: string): Promise<boolean> {
    // 1. stop being billed: cancel at the provider (a failure here must not strand the customer's data forever, but it is loud)
    const sub = await this.db.tenantTx({ tenantId }, (tx) => tx.subscription.findUnique({ where: { tenantId }, select: { providerSubscriptionId: true, provider: true, status: true } }));
    let billing: 'cancelled' | 'none' | 'failed' = 'none';
    if (sub?.provider === 'razorpay' && sub.providerSubscriptionId && sub.status !== 'EXPIRED') {
      try { await this.provider().cancelSubscription(sub.providerSubscriptionId, false); billing = 'cancelled'; } catch (e) { billing = 'failed'; this.log.error(`Could not cancel the subscription of tenant ${tenantId} at the provider: ${e instanceof Error ? e.message : String(e)}. Cancel it manually in the Razorpay dashboard.`); }
    }
    // 2. files
    let files: number;
    try { files = await this.storage().deletePrefix(`tenants/${tenantId}/`); } catch (e) { this.log.error(`Object storage purge failed for tenant ${tenantId}: ${e instanceof Error ? e.message : String(e)}`); return false; }
    // 3. rows (one transaction inside the function: all or nothing)
    const rows = await this.db.prisma.$queryRaw<{ r: { tables: Record<string, number>; users_deleted: number } | null }[]>`SELECT purge_tenant(${tenantId}::uuid) AS r`;
    const r = rows[0]?.r;
    if (!r) return false;
    // 4. the only record left: content-free, platform-owned
    await this.db.prisma.platformAuditLog.createMany({ data: [{ action: 'platform.tenant_purged', targetType: 'tenant', targetId: tenantId, tenantId, reason: 'deletion cooling-off period ended', metadata: { files, usersDeleted: r.users_deleted, rows: Object.values(r.tables).reduce((a, b) => a + b, 0), billing } }] });
    return true;
  }
}
