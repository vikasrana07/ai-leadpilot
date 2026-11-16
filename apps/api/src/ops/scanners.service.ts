import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { DEFAULT_SLA, type AutomationTrigger, type SlaSettings } from '@leadpilot/validation';
import { AiTrigger } from '../ai/ai-trigger.js';
import { DbService } from '../db/db.module.js';
import { AGENT_REMINDER_HOURS } from './event-notifier.js';
import { BillingLifecycle } from './billing-lifecycle.js';
import { OutboxService } from './outbox.service.js';

export function readSla(settings: Prisma.JsonValue): SlaSettings {
  const s = (settings as { sla?: Partial<SlaSettings> } | null)?.sla;
  return { enabled: s?.enabled ?? DEFAULT_SLA.enabled, firstResponseMinutes: s?.firstResponseMinutes ?? DEFAULT_SLA.firstResponseMinutes };
}

export interface ScanReport { tenantId: string; upcoming: number; inactive: number; tasksDue: number; slaBreaches: number; slaResolved: number; aiRecovered: number; staleRunsRequeued: number; queuedRuns: string[] }

/**
 * Time-driven work. Every scanner is idempotent: it records an `event_marks` row (primary key tenant+key) in the same transaction that
 * emits the event, so two scanners (or two ticks) racing produce the event exactly once. Scanners only EMIT outbox events; the relay does the rest.
 */
@Injectable()
export class ScannersService {
  private readonly log = new Logger('Scanners');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(OutboxService) private readonly outbox: OutboxService, @Inject(AiTrigger) private readonly aiTrigger: AiTrigger, @Inject(BillingLifecycle) private readonly billing: BillingLifecycle) {}

  async scanAll(now = new Date()): Promise<ScanReport[]> {
    const tenants = await this.db.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM list_active_tenant_ids()`;
    const reports: ScanReport[] = [];
    for (const t of tenants) {
      try { reports.push(await this.scanTenant(t.id, now)); } catch (e) { this.log.error(`Scan failed for tenant ${t.id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return reports;
  }

  /** Returns true when this call is the first to claim the key. */
  private async mark(tx: TxClient, tenantId: string, key: string): Promise<boolean> {
    return (await tx.eventMark.createMany({ data: [{ tenantId, key }], skipDuplicates: true })).count === 1;
  }

  async scanTenant(tenantId: string, now = new Date()): Promise<ScanReport> {
    const r: ScanReport = { tenantId, upcoming: 0, inactive: 0, tasksDue: 0, slaBreaches: 0, slaResolved: 0, aiRecovered: 0, staleRunsRequeued: 0, queuedRuns: [] };
    const aiRecover: { conversationId: string; messageId: string }[] = [];
    await this.db.tenantTx({ tenantId }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
      const automations = await tx.automation.findMany({ where: { tenantId, enabled: true }, select: { trigger: true } });
      const triggers = automations.map((a) => a.trigger as unknown as AutomationTrigger);
      r.upcoming = await this.scanUpcoming(tx, tenantId, now, [...new Set([AGENT_REMINDER_HOURS, ...triggers.flatMap((t) => (t.type === 'appointment.upcoming' && t.hoursBefore ? [t.hoursBefore] : []))])]);
      r.inactive = await this.scanInactive(tx, tenantId, now, [...new Set(triggers.flatMap((t) => (t.type === 'lead.inactive' && t.days ? [t.days] : [])))]);
      r.tasksDue = await this.scanTasks(tx, tenantId, now);
      const sla = readSla(tenant.settings);
      if (sla.enabled) r.slaBreaches = await this.scanSla(tx, tenantId, now, sla);
      r.slaResolved = await this.resolveSla(tx, tenantId);
      aiRecover.push(...(await this.findStuckAiTurns(tx, tenantId, now)));
      const stuck = await tx.automationRun.updateMany({ where: { tenantId, status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, data: { status: 'QUEUED' } });
      r.staleRunsRequeued = stuck.count;
      r.queuedRuns = (await tx.automationRun.findMany({ where: { tenantId, status: 'QUEUED', createdAt: { lt: new Date(now.getTime() - 45_000) } }, select: { id: true }, take: 200 })).map((x) => x.id);
    });
    await this.billing.tick(tenantId, now).catch((e: unknown) => this.log.error(`Billing tick failed for tenant ${tenantId}: ${e instanceof Error ? e.message : String(e)}`));
    for (const t of aiRecover) { this.aiTrigger.fire({ tenantId, ...t }); r.aiRecovered++; }
    return r;
  }

  /** Reminders fire once per (appointment, lead time) and only if the appointment still lies ahead and was booked before the reminder time. */
  private async scanUpcoming(tx: TxClient, tenantId: string, now: Date, hours: number[]): Promise<number> {
    let n = 0;
    for (const h of hours) {
      const rows = await tx.appointment.findMany({ where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: now, lte: new Date(now.getTime() + h * 3600_000) } }, take: 500 });
      for (const ap of rows) {
        if (!(await this.mark(tx, tenantId, `appt-up:${ap.id}:${h}`))) continue;
        // Missed by more than half the lead time (scanner was down): a "tomorrow" reminder for a visit minutes away would only confuse.
        if (ap.startsAt.getTime() - now.getTime() < h * 3600_000 * 0.5) continue;
        // Booked inside the reminder window (e.g. 3 hours ahead for a 24h reminder): that reminder is moot.
        if (ap.createdAt.getTime() > ap.startsAt.getTime() - h * 3600_000) continue;
        await this.outbox.emit(tx, tenantId, 'appointment.upcoming', { appointmentId: ap.id, leadId: ap.leadId, membershipId: ap.membershipId, hoursBefore: h });
        n++;
      }
    }
    return n;
  }

  private async scanInactive(tx: TxClient, tenantId: string, now: Date, days: number[]): Promise<number> {
    let n = 0;
    for (const d of days) {
      const cutoff = new Date(now.getTime() - d * 86_400_000);
      const leads = await tx.lead.findMany({ where: { tenantId, deletedAt: null, mergedIntoId: null, stage: { kind: 'OPEN' }, createdAt: { lt: cutoff }, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: cutoff } }] }, select: { id: true, createdAt: true, lastContactedAt: true }, take: 200 });
      for (const l of leads) {
        const convo = await tx.conversation.findFirst({ where: { leadId: l.id }, orderBy: { lastMessageAt: 'desc' }, select: { lastMessageAt: true } });
        const last = Math.max(l.lastContactedAt?.getTime() ?? 0, convo?.lastMessageAt.getTime() ?? 0, l.createdAt.getTime());
        if (last >= cutoff.getTime()) continue;
        if (!(await this.mark(tx, tenantId, `inactive:${l.id}:${d}:${Math.floor(last / 1000)}`))) continue; // once per quiet period; fresh contact starts a new period
        await this.outbox.emit(tx, tenantId, 'lead.inactive', { leadId: l.id, days: d });
        n++;
      }
    }
    return n;
  }

  private async scanTasks(tx: TxClient, tenantId: string, now: Date): Promise<number> {
    const due = await tx.task.findMany({ where: { tenantId, status: 'OPEN', dueAt: { lte: now }, remindedAt: null }, take: 200 });
    let n = 0;
    for (const t of due) {
      const claimed = await tx.task.updateMany({ where: { id: t.id, remindedAt: null }, data: { remindedAt: now } });
      if (claimed.count !== 1) continue;
      await this.outbox.emit(tx, tenantId, 'task.due', { taskId: t.id, ...(t.leadId ? { leadId: t.leadId } : {}), ...(t.assigneeMembershipId ? { assigneeMembershipId: t.assigneeMembershipId } : {}), title: t.title });
      n++;
    }
    return n;
  }

  /** A customer message that nobody (person or AI) answered within the SLA, in a conversation a human is expected to handle. */
  private async scanSla(tx: TxClient, tenantId: string, now: Date, sla: SlaSettings): Promise<number> {
    const cutoff = new Date(now.getTime() - sla.firstResponseMinutes * 60_000);
    const convos = await tx.conversation.findMany({ where: { tenantId, status: 'OPEN', mode: 'HUMAN', unreadCount: { gt: 0 }, lastInboundAt: { lt: cutoff } }, select: { id: true, leadId: true }, take: 200 });
    let n = 0;
    for (const c of convos) {
      const lastReply = await tx.message.findFirst({ where: { conversationId: c.id, direction: 'OUTBOUND', senderType: { in: ['AGENT', 'AI'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      const firstWaiting = await tx.message.findFirst({ where: { conversationId: c.id, direction: 'INBOUND', ...(lastReply ? { createdAt: { gt: lastReply.createdAt } } : {}) }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true } });
      if (!firstWaiting || firstWaiting.createdAt > cutoff) continue;
      const created = await tx.slaBreach.createMany({ data: [{ tenantId, conversationId: c.id, inboundMessageId: firstWaiting.id }], skipDuplicates: true });
      if (created.count !== 1) continue;
      await this.outbox.emit(tx, tenantId, 'sla.breached', { conversationId: c.id, leadId: c.leadId, messageId: firstWaiting.id, minutes: sla.firstResponseMinutes });
      n++;
    }
    return n;
  }

  private async resolveSla(tx: TxClient, tenantId: string): Promise<number> {
    const open = await tx.slaBreach.findMany({ where: { tenantId, resolvedAt: null }, take: 200 });
    let n = 0;
    for (const b of open) {
      const inbound = await tx.message.findFirst({ where: { id: b.inboundMessageId }, select: { createdAt: true } });
      if (!inbound) continue;
      const reply = await tx.message.findFirst({ where: { conversationId: b.conversationId, direction: 'OUTBOUND', senderType: { in: ['AGENT', 'AI'] }, createdAt: { gt: inbound.createdAt } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
      if (!reply) continue;
      await tx.slaBreach.update({ where: { id: b.id }, data: { resolvedAt: reply.createdAt, minutesToRespond: Math.max(1, Math.round((reply.createdAt.getTime() - inbound.createdAt.getTime()) / 60_000)) } });
      n++;
    }
    return n;
  }

  /**
   * The AI debounce timer lives in memory, so a restart can lose a pending reply. Anything left unanswered for 90 seconds to 6 hours in an
   * AI conversation is handed back to the orchestrator once (the orchestrator itself skips messages it has already answered).
   */
  private async findStuckAiTurns(tx: TxClient, tenantId: string, now: Date): Promise<{ conversationId: string; messageId: string }[]> {
    const convos = await tx.conversation.findMany({ where: { tenantId, status: 'OPEN', mode: 'AI', lastInboundAt: { gt: new Date(now.getTime() - 6 * 3600_000), lt: new Date(now.getTime() - 90_000) }, unreadCount: { gt: 0 } }, select: { id: true }, take: 50 });
    const out: { conversationId: string; messageId: string }[] = [];
    for (const c of convos) {
      const last = await tx.message.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, select: { id: true, direction: true, senderType: true, createdAt: true } });
      if (!last || last.direction !== 'INBOUND' || last.senderType !== 'CUSTOMER') continue;
      const recentRun = await tx.aiRun.findFirst({ where: { conversationId: c.id, createdAt: { gt: new Date(now.getTime() - 5 * 60_000) } }, select: { id: true } });
      if (recentRun) continue;
      if (!(await this.mark(tx, tenantId, `ai-recover:${last.id}`))) continue;
      out.push({ conversationId: c.id, messageId: last.id });
    }
    return out;
  }
}
