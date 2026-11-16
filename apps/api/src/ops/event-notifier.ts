import { Inject, Injectable } from '@nestjs/common';
import type { TxClient } from '@leadpilot/database';
import { NotificationsService, type CreatedNotification } from './notifications.service.js';
import type { DomainEvent } from './automation-engine.js';

/** Built-in, non-configurable notifications for domain events (people can mute any type in their preferences). */
@Injectable()
export class EventNotifier {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  private async managers(tx: TxClient, tenantId: string): Promise<string[]> {
    return (await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: { in: ['owner', 'manager'] } } }, select: { id: true } })).map((m) => m.id);
  }

  /** The person who caused an event is never notified about their own action. */
  private async skipSelf(tx: TxClient, membershipId: string | null, byUserId: unknown): Promise<boolean> {
    if (!membershipId || typeof byUserId !== 'string') return false;
    return (await tx.membership.findFirst({ where: { id: membershipId }, select: { userId: true } }))?.userId === byUserId;
  }

  async handle(tx: TxClient, ev: DomainEvent): Promise<CreatedNotification[]> {
    const p = ev.payload as Record<string, unknown>;
    const str = (k: string): string | null => (typeof p[k] === 'string' ? (p[k] as string) : null);
    const leadId = str('leadId');
    const lead = leadId ? await tx.lead.findFirst({ where: { id: leadId }, select: { id: true, name: true, assignedMembershipId: true } }) : null;
    const t = ev.tenantId;
    switch (ev.type) {
      case 'lead.assigned': {
        const to = str('membershipId');
        if (!lead || !to || (await this.skipSelf(tx, to, p.byUserId))) return [];
        return this.notifications.create(tx, { tenantId: t, membershipIds: [to], type: 'lead_assigned', title: `New lead assigned: ${lead.name}`, link: `/leads/${lead.id}` });
      }
      case 'lead.temperature_changed': {
        if (!lead || p.to !== 'HOT') return [];
        const targets = lead.assignedMembershipId ? [lead.assignedMembershipId] : await this.managers(tx, t);
        return this.notifications.create(tx, { tenantId: t, membershipIds: targets, type: 'hot_lead', title: `${lead.name} is now a hot lead`, body: 'Reach out while interest is high.', link: `/leads/${lead.id}` });
      }
      case 'conversation.handover': {
        const cid = str('conversationId');
        if (!lead || !cid) return [];
        const targets = lead.assignedMembershipId ? [lead.assignedMembershipId] : await this.managers(tx, t);
        return this.notifications.create(tx, { tenantId: t, membershipIds: targets, type: 'handover', title: `AI handed over: ${lead.name}`, body: str('reason') ?? undefined, link: `/conversations?c=${cid}` });
      }
      case 'appointment.booked': {
        const m = str('membershipId'); const aid = str('appointmentId');
        if (!lead || !m || !aid || (await this.skipSelf(tx, m, p.byUserId))) return [];
        const ap = await tx.appointment.findFirst({ where: { id: aid }, select: { startsAt: true, status: true, source: true } });
        if (!ap) return [];
        const when = await this.when(tx, t, ap.startsAt);
        const needsConfirm = ap.status === 'PENDING';
        return this.notifications.create(tx, { tenantId: t, membershipIds: [m], type: 'appointment_booked', title: `${needsConfirm ? 'Please confirm visit' : 'New visit'}: ${lead.name}, ${when}`, body: ap.source === 'ai' ? 'Booked by the AI assistant.' : undefined, link: `/appointments?a=${aid}` });
      }
      case 'appointment.cancelled': case 'appointment.rescheduled': case 'appointment.no_show': {
        const m = str('membershipId'); const aid = str('appointmentId');
        if (!lead || !m || (await this.skipSelf(tx, m, p.byUserId))) return [];
        const verb = ev.type === 'appointment.cancelled' ? 'cancelled' : ev.type === 'appointment.no_show' ? 'marked as a no-show' : 'rescheduled';
        return this.notifications.create(tx, { tenantId: t, membershipIds: [m], type: 'appointment_changed', title: `Visit with ${lead.name} ${verb}`, link: aid ? `/appointments?a=${aid}` : '/appointments' });
      }
      case 'appointment.upcoming': {
        const m = str('membershipId'); const aid = str('appointmentId'); const h = typeof p.hoursBefore === 'number' ? p.hoursBefore : null;
        if (!lead || !m || !aid || h !== AGENT_REMINDER_HOURS) return [];
        const ap = await tx.appointment.findFirst({ where: { id: aid }, select: { startsAt: true } });
        return this.notifications.create(tx, { tenantId: t, membershipIds: [m], type: 'appointment_reminder', title: `Visit soon: ${lead.name}, ${ap ? await this.when(tx, t, ap.startsAt) : 'shortly'}`, link: `/appointments?a=${aid}` });
      }
      case 'task.due': {
        const m = str('assigneeMembershipId'); const title = str('title');
        if (!m) return [];
        return this.notifications.create(tx, { tenantId: t, membershipIds: [m], type: 'task_due', title: `Task due: ${title ?? 'follow up'}`, link: lead ? `/leads/${lead.id}` : '/tasks' });
      }
      case 'sla.breached': {
        const cid = str('conversationId');
        const targets = [...new Set([...(lead?.assignedMembershipId ? [lead.assignedMembershipId] : []), ...(await this.managers(tx, t))])];
        return this.notifications.create(tx, { tenantId: t, membershipIds: targets, type: 'sla_breach', title: `Waiting for a reply: ${lead?.name ?? 'a customer'}`, body: `No response within ${typeof p.minutes === 'number' ? p.minutes : 15} minutes.`, link: cid ? `/conversations?c=${cid}` : '/conversations' });
      }
      case 'lead.inactive': {
        if (!lead) return [];
        const targets = lead.assignedMembershipId ? [lead.assignedMembershipId] : await this.managers(tx, t);
        return this.notifications.create(tx, { tenantId: t, membershipIds: targets, type: 'lead_inactive', title: `No contact with ${lead.name} for ${typeof p.days === 'number' ? p.days : 'several'} days`, link: `/leads/${lead.id}` });
      }
      default: return [];
    }
  }

  private async when(tx: TxClient, tenantId: string, at: Date): Promise<string> {
    const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
    return `${new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(at)}, ${new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at).toUpperCase()}`;
  }
}

/** Agents always get a reminder this long before a visit, independent of any automation. */
export const AGENT_REMINDER_HOURS = 1;
