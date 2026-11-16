import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { DbService } from '../db/db.module.js';

export interface AuditEntry {
  tenantId: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonObject;
  requestId?: string;
  ip?: string | undefined;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Record inside an existing (tenant) transaction so the audit row commits atomically with the change. */
  record(tx: TxClient, e: AuditEntry): Promise<unknown> {
    // createMany (no RETURNING): rows with tenant_id NULL are insert-only for the app role, so a RETURNING
    // clause would be rejected by the SELECT policy. That is intentional: tenants must never read global rows.
    return tx.auditLog.createMany({
      data: [{
        tenantId: e.tenantId,
        actorUserId: e.actorUserId ?? null,
        action: e.action,
        resourceType: e.resourceType ?? null,
        resourceId: e.resourceId ?? null,
        metadata: e.metadata ?? {},
        requestId: e.requestId ?? null,
        ip: e.ip ?? null,
      }],
    });
  }

  /** Standalone record (e.g. failed login with no tenant). */
  async recordStandalone(e: AuditEntry): Promise<void> {
    await this.db.userTx(e.actorUserId ?? null, async (tx) => {
      if (e.tenantId) await tx.$executeRaw`SELECT set_config('app.tenant_id', ${e.tenantId}, true)`;
      await this.record(tx, e);
    });
  }
}
