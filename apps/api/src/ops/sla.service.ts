import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { slaSettingsSchema, type SlaSettings } from '@leadpilot/validation';
import type { Prisma, TxClient } from '@leadpilot/database';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';
import { readSla } from './scanners.service.js';

@Injectable()
export class SlaService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService) {}
  private tx<T>(a: Actor, fn: (tx: TxClient) => Promise<T>): Promise<T> { return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, fn); }

  async get(a: Actor) {
    if (!a.permissions.has('settings:manage') && !a.permissions.has('analytics:read:team')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot view SLA settings' });
    return this.tx(a, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } });
      const since = new Date(Date.now() - 30 * 86_400_000);
      const breaches = await tx.slaBreach.findMany({ where: { tenantId: a.tenantId, breachedAt: { gte: since } }, orderBy: { breachedAt: 'desc' }, take: 50 });
      const open = breaches.filter((b) => b.resolvedAt === null);
      const resolved = breaches.filter((b) => b.minutesToRespond !== null);
      const convos = await tx.conversation.findMany({ where: { id: { in: breaches.map((b) => b.conversationId) } }, select: { id: true, leadId: true } });
      const leads = await tx.lead.findMany({ where: { id: { in: convos.map((c) => c.leadId) } }, select: { id: true, name: true } });
      const leadOf = new Map(convos.map((c) => [c.id, leads.find((l) => l.id === c.leadId)?.name ?? null]));
      return {
        settings: readSla(t.settings),
        last30Days: { breaches: breaches.length, open: open.length, avgMinutesToRespond: resolved.length ? Math.round(resolved.reduce((s, b) => s + (b.minutesToRespond ?? 0), 0) / resolved.length) : null },
        recent: breaches.slice(0, 10).map((b) => ({ id: b.id, conversationId: b.conversationId, leadName: leadOf.get(b.conversationId) ?? null, breachedAt: b.breachedAt.toISOString(), resolvedAt: b.resolvedAt?.toISOString() ?? null, minutesToRespond: b.minutesToRespond })),
      };
    });
  }

  async update(a: Actor, input: SlaSettings) {
    if (!a.permissions.has('settings:manage')) throw new ForbiddenException({ code: 'forbidden', message: 'Only workspace admins can change SLA settings' });
    const parsed = slaSettingsSchema.parse(input);
    await this.tx(a, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId }, select: { settings: true } });
      await tx.tenant.update({ where: { id: a.tenantId }, data: { settings: { ...((t.settings ?? {}) as Prisma.InputJsonObject), sla: parsed } } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'sla.updated', resourceType: 'tenant', resourceId: a.tenantId, metadata: parsed as unknown as Prisma.InputJsonObject, ...(a.requestId ? { requestId: a.requestId } : {}) });
    });
    return this.get(a);
  }
}
