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

/**
 * Changing industry during onboarding: swaps the pipeline, lost reasons and custom fields for the new pack, but ONLY while the workspace
 * has no leads yet (nothing to orphan). Once data exists the pack stays as it is and only the industry label changes (ADR 0011).
 * Returns true when the pack was replaced.
 */
export async function switchIndustryPack(tx: TxClient, tenantId: string, industry: string, newId: () => string = randomUUID): Promise<boolean> {
  const pack = packForIndustry(industry);
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { industryPackId: true } });
  if (tenant.industryPackId === pack.id) return false;
  if ((await tx.lead.count({ where: { tenantId } })) > 0) return false;
  await tx.pipelineStage.deleteMany({ where: { tenantId } });
  await tx.lostReason.deleteMany({ where: { tenantId } });
  await tx.customFieldDefinition.deleteMany({ where: { tenantId, entity: 'lead' } });
  await tx.leadSource.deleteMany({ where: { tenantId, isSystem: true } }); // pack sources only; sources the tenant added itself stay
  await applyIndustryPack(tx, tenantId, industry, newId);
  await tx.tenant.update({ where: { id: tenantId }, data: { industryPackId: pack.id } });
  return true;
}
