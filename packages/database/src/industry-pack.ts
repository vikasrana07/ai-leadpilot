import { randomUUID } from 'node:crypto';
import { packForIndustry } from '@leadpilot/shared-types';
import type { TxClient } from './index.js';

/**
 * Copies an Industry Pack into the tenant's own tables (stages, lost reasons, sources, custom fields).
 * Idempotent: only inserts what is missing, never overwrites tenant edits. Run inside a tenant-scoped transaction.
 */
export async function applyIndustryPack(tx: TxClient, tenantId: string, industry: string, newId: () => string = randomUUID): Promise<void> {
  const pack = packForIndustry(industry);
  if ((await tx.pipelineStage.count({ where: { tenantId } })) === 0) {
    await tx.pipelineStage.createMany({
      data: pack.stages.map((s, i) => ({ id: newId(), tenantId, key: s.key, name: s.name, position: i, kind: s.kind, qualifies: s.qualifies ?? false, canCloseWon: s.canCloseWon ?? false })),
    });
  }
  if ((await tx.lostReason.count({ where: { tenantId } })) === 0) {
    await tx.lostReason.createMany({ data: pack.lostReasons.map((name, i) => ({ id: newId(), tenantId, name, position: i })) });
  }
  const haveSources = new Set((await tx.leadSource.findMany({ where: { tenantId }, select: { key: true } })).map((s) => s.key));
  const missing = pack.sources.filter((s) => !haveSources.has(s.key));
  if (missing.length) await tx.leadSource.createMany({ data: missing.map((s) => ({ id: newId(), tenantId, key: s.key, name: s.name, isSystem: true })) });
  if ((await tx.customFieldDefinition.count({ where: { tenantId } })) === 0 && pack.customFields.length) {
    await tx.customFieldDefinition.createMany({
      data: pack.customFields.map((f, i) => ({ id: newId(), tenantId, entity: 'lead', key: f.key, label: f.label, type: f.type, options: f.options ?? [], position: i })),
    });
  }
}
