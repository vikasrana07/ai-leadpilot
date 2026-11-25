import { createHash, createHmac } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
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

export interface WormExportManifest {
  _type: 'worm_manifest';
  tenantId: string;
  exportedAt: string;
  recordCount: number;
  chainAlgorithm: 'SHA-256';
  rootHash: string;
  signature: string;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Optional() @Inject(ENV) private readonly env?: Env,
  ) {}

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

  /**
   * Produces a tamper-evident, SHA-256 hash-chained WORM (Write-Once-Read-Many) export for a workspace.
   * Each record is linked to the previous record's hash, and the final root hash is HMAC-signed.
   */
  async exportWorm(
    tenantId: string,
    opts: { from?: Date; to?: Date; actorUserId?: string | null; requestId?: string; ip?: string } = {},
  ): Promise<{ content: string; manifest: WormExportManifest }> {
    const rows = await this.db.tenantTx({ tenantId }, async (tx) => {
      const list = await tx.auditLog.findMany({
        where: {
          tenantId,
          ...(opts.from || opts.to
            ? {
                createdAt: {
                  ...(opts.from ? { gte: opts.from } : {}),
                  ...(opts.to ? { lte: opts.to } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50_000,
      });

      await this.record(tx, {
        tenantId,
        actorUserId: opts.actorUserId ?? null,
        action: 'audit.worm_exported',
        resourceType: 'audit_log',
        metadata: {
          recordCount: list.length,
          ...(opts.from ? { from: opts.from.toISOString() } : {}),
          ...(opts.to ? { to: opts.to.toISOString() } : {}),
        },
        ...(opts.requestId ? { requestId: opts.requestId } : {}),
        ...(opts.ip ? { ip: opts.ip } : {}),
      });

      return list;
    });

    let prevHash = 'genesis';
    const lines: string[] = [];

    for (const row of rows) {
      const payload = {
        id: row.id,
        tenantId: row.tenantId,
        actorUserId: row.actorUserId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: row.metadata,
        requestId: row.requestId,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
        prevHash,
      };
      const recordHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      lines.push(JSON.stringify({ ...payload, recordHash }));
      prevHash = recordHash;
    }

    const signingKey = this.env?.JWT_ACCESS_SECRET ?? 'leadpilot-worm-dev-key';
    const signature = createHmac('sha256', signingKey).update(`${tenantId}:${rows.length}:${prevHash}`).digest('hex');
    const manifest: WormExportManifest = {
      _type: 'worm_manifest',
      tenantId,
      exportedAt: new Date().toISOString(),
      recordCount: rows.length,
      chainAlgorithm: 'SHA-256',
      rootHash: prevHash,
      signature,
    };
    lines.push(JSON.stringify(manifest));

    return { content: lines.join('\n') + '\n', manifest };
  }

  /** Verifies the SHA-256 hash chain of a WORM JSONL export. */
  static verifyWormChain(jsonl: string): { valid: boolean; recordCount: number; rootHash: string; error?: string } {
    const rawLines = jsonl.trim().split('\n').filter(Boolean);
    if (rawLines.length === 0) return { valid: false, recordCount: 0, rootHash: 'genesis', error: 'Empty export' };

    const last = JSON.parse(rawLines[rawLines.length - 1]!) as Partial<WormExportManifest>;
    if (last._type !== 'worm_manifest') {
      return { valid: false, recordCount: 0, rootHash: 'genesis', error: 'Missing trailing WORM manifest' };
    }

    let prevHash = 'genesis';
    const recordLines = rawLines.slice(0, -1);
    for (let i = 0; i < recordLines.length; i++) {
      const item = JSON.parse(recordLines[i]!) as Record<string, unknown>;
      const { recordHash, ...rest } = item;
      if (rest.prevHash !== prevHash) {
        return { valid: false, recordCount: i, rootHash: prevHash, error: `Broken prevHash at index ${i}` };
      }
      const expected = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
      if (expected !== recordHash) {
        return { valid: false, recordCount: i, rootHash: prevHash, error: `Tampered record hash at index ${i}` };
      }
      prevHash = expected;
    }

    if (prevHash !== last.rootHash || recordLines.length !== last.recordCount) {
      return { valid: false, recordCount: recordLines.length, rootHash: prevHash, error: 'Manifest rootHash/count mismatch' };
    }

    return { valid: true, recordCount: recordLines.length, rootHash: prevHash };
  }
}
