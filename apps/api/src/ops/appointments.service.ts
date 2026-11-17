import { packForIndustry } from '@leadpilot/shared-types';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { APPOINTMENT_TRANSITIONS, type AppointmentCreateInput, type AppointmentListQuery, type SlotsQuery } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { addDays, localParts } from '../common/tz.js';
import { DbService } from '../db/db.module.js';
import { loadAvailability, slotsForDate, withinWorkingHours } from './availability.js';
import { OutboxService } from './outbox.service.js';

type Row = Prisma.AppointmentGetPayload<{ include: { events: true } }>;
export interface AppointmentDto {
  id: string; leadId: string; leadName: string; leadPhone: string | null; membershipId: string; agentName: string; propertyId: string | null; title: string;
  startsAt: string; endsAt: string; status: string; notes: string | null; location: string | null; source: string; cancelledReason: string | null;
  rescheduledFromId: string | null; createdAt: string; events?: { id: string; type: string; data: unknown; createdAt: string }[];
}
export interface BookOptions { source: 'manual' | 'ai' | 'automation' | 'api'; status?: 'PENDING' | 'CONFIRMED' }

/** Postgres exclusion violation (23P01) surfaces through Prisma wrapped in various error classes: look at the whole chain. */
export function overlapKind(e: unknown): 'agent' | 'lead' | null {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur; i++) {
    const text = `${(cur as { message?: string }).message ?? ''} ${JSON.stringify((cur as { meta?: unknown }).meta ?? '')} ${(cur as { originalCode?: string }).originalCode ?? ''}`;
    if (text.includes('appointments_agent_no_overlap')) return 'agent';
    if (text.includes('appointments_lead_no_overlap')) return 'lead';
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

@Injectable()
export class AppointmentsService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService, @Inject(OutboxService) private readonly outbox: OutboxService) {}

  private tx<T>(a: Actor, fn: (tx: TxClient) => Promise<T>): Promise<T> { return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, fn); }

  private canSeeAll(a: Actor): boolean { return a.permissions.has('appointment:read:all'); }
  private requireWrite(a: Actor): void { if (!a.permissions.has('appointment:write')) throw new ForbiddenException({ code: 'forbidden', message: 'You do not have permission to change appointments' }); }
  private requireRead(a: Actor): void { if (!this.canSeeAll(a) && !(a.permissions.has('appointment:read:own') && a.membershipId)) throw new ForbiddenException({ code: 'forbidden', message: 'You do not have permission to view appointments' }); }
  /** Agents work with their own appointments; managers with everyone's. */
  private assertOwnsOrAll(a: Actor, membershipId: string): void { if (!this.canSeeAll(a) && membershipId !== a.membershipId) throw new NotFoundException({ code: 'not_found', message: 'Appointment not found' }); }

  // ------------------------------------------------------------------ mapping
  private async toDtos(tx: TxClient, rows: Row[] | Omit<Row, 'events'>[], withEvents = false): Promise<AppointmentDto[]> {
    const leads = await tx.lead.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.leadId))] } }, select: { id: true, name: true, phone: true } });
    const ms = await tx.membership.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.membershipId))] } }, select: { id: true, user: { select: { name: true } } } });
    const L = new Map(leads.map((l) => [l.id, l])); const M = new Map(ms.map((m) => [m.id, m.user.name]));
    return rows.map((r) => ({
      id: r.id, leadId: r.leadId, leadName: L.get(r.leadId)?.name ?? 'Unknown', leadPhone: L.get(r.leadId)?.phone ?? null, membershipId: r.membershipId, agentName: M.get(r.membershipId) ?? 'Unknown',
      propertyId: r.propertyId, title: r.title, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), status: r.status, notes: r.notes, location: r.location, source: r.source,
      cancelledReason: r.cancelledReason, rescheduledFromId: r.rescheduledFromId, createdAt: r.createdAt.toISOString(),
      ...(withEvents && 'events' in r ? { events: [...r.events].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()).map((e) => ({ id: e.id, type: e.type, data: e.data, createdAt: e.createdAt.toISOString() })) } : {}),
    }));
  }

  private async tenantTz(tx: TxClient, tenantId: string): Promise<string> { return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone; }

  eligibleAgentIds(tx: TxClient, tenantId: string): Promise<string[]> { return this.eligibleAgents(tx, tenantId); }

  private async eligibleAgents(tx: TxClient, tenantId: string): Promise<string[]> {
    const ms = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { permissions: { some: { permissionKey: 'appointment:write' } } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    return ms.map((m) => m.id);
  }

  // ------------------------------------------------------------------ reads
  async list(a: Actor, q: AppointmentListQuery) {
    this.requireRead(a);
    return this.tx(a, async (tx) => {
      const where: Prisma.AppointmentWhereInput = {
        ...(this.canSeeAll(a) ? (q.membershipId ? { membershipId: q.membershipId } : {}) : { membershipId: a.membershipId as string }),
        ...(q.status ? { status: q.status } : {}), ...(q.leadId ? { leadId: q.leadId } : {}),
        ...(q.from || q.to ? { startsAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
      };
      const rows = await tx.appointment.findMany({ where, orderBy: { startsAt: 'asc' }, take: q.limit });
      return { items: await this.toDtos(tx, rows), timezone: await this.tenantTz(tx, a.tenantId) };
    });
  }

  async get(a: Actor, id: string): Promise<AppointmentDto> {
    this.requireRead(a);
    return this.tx(a, async (tx) => {
      const row = await tx.appointment.findFirst({ where: { id }, include: { events: true } });
      if (!row) throw new NotFoundException({ code: 'not_found', message: 'Appointment not found' });
      this.assertOwnsOrAll(a, row.membershipId);
      return (await this.toDtos(tx, [row], true))[0] as AppointmentDto;
    });
  }

  async slots(a: Actor, q: SlotsQuery) {
    this.requireRead(a);
    return this.tx(a, async (tx) => {
      const tz = await this.tenantTz(tx, a.tenantId);
      const eligible = await this.eligibleAgents(tx, a.tenantId);
      let ids = eligible;
      if (q.membershipId) { if (!eligible.includes(q.membershipId)) throw new BadRequestException({ code: 'invalid_agent', message: 'That team member cannot take appointments' }); ids = [q.membershipId]; }
      else if (!this.canSeeAll(a)) ids = a.membershipId && eligible.includes(a.membershipId) ? [a.membershipId] : [];
      return this.slotsFor(tx, a.tenantId, tz, ids, q.from, q.days, q.durationMinutes);
    });
  }

  /** Shared with the AI scheduling tool. */
  async slotsFor(tx: TxClient, tenantId: string, tz: string, membershipIds: string[], fromDate: string, days: number, durationMinutes: number, now = new Date()) {
    const data = await loadAvailability(tx, tenantId);
    const rangeStart = new Date(`${fromDate}T00:00:00Z`); rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
    const rangeEnd = new Date(`${addDays(fromDate, days)}T00:00:00Z`); rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
    const busyRows = await tx.appointment.findMany({ where: { membershipId: { in: membershipIds }, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } }, select: { membershipId: true, startsAt: true, endsAt: true } });
    const out: { date: string; slots: { startsAt: string; endsAt: string; membershipIds: string[] }[] }[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(fromDate, i);
      const slots = slotsForDate({ data, date, tz, durationMinutes, membershipIds, busy: busyRows, now });
      out.push({ date, slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), membershipIds: s.membershipIds })) });
    }
    return { timezone: tz, days: out };
  }

  // ------------------------------------------------------------------ booking
  /**
   * Books an appointment. Overlap protection is enforced by the database (exclusion constraints); the checks here only produce
   * friendly errors and honour working hours. When no agent is requested the least-busy eligible agent who is free is used, and a
   * lost race on one agent falls through to the next candidate.
   */
  async create(a: Actor, input: AppointmentCreateInput, opts: BookOptions = { source: 'manual' }): Promise<AppointmentDto> {
    this.requireWrite(a);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    if (startsAt.getTime() < Date.now()) throw new UnprocessableEntityException({ code: 'in_the_past', message: 'That time has already passed' });
    if (input.outsideHours && !this.canSeeAll(a)) throw new ForbiddenException({ code: 'forbidden', message: 'Only managers can book outside working hours' });

    const plan = await this.tx(a, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: input.leadId, deletedAt: null, mergedIntoId: null }, select: { id: true, name: true, assignedMembershipId: true } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const canWriteLead = a.permissions.has('lead:write:all') || (a.permissions.has('lead:write:own') && a.membershipId !== null && lead.assignedMembershipId === a.membershipId);
      if (!canWriteLead) throw new ForbiddenException({ code: 'forbidden', message: 'You can only book appointments for leads assigned to you' });
      const tz = await this.tenantTz(tx, a.tenantId);
      const eligible = await this.eligibleAgents(tx, a.tenantId);
      let candidates: string[];
      if (input.membershipId) {
        if (!eligible.includes(input.membershipId)) throw new BadRequestException({ code: 'invalid_agent', message: 'That team member cannot take appointments' });
        candidates = [input.membershipId];
      } else if (lead.assignedMembershipId && eligible.includes(lead.assignedMembershipId)) candidates = [lead.assignedMembershipId, ...eligible.filter((x) => x !== lead.assignedMembershipId)];
      else candidates = eligible;
      if (!this.canSeeAll(a) && a.membershipId && !input.membershipId && a.userId) candidates = candidates.filter((c) => c === a.membershipId);
      if (!this.canSeeAll(a) && input.membershipId && input.membershipId !== a.membershipId) throw new ForbiddenException({ code: 'forbidden', message: 'You can only book appointments for yourself' });
      if (candidates.length === 0) throw new UnprocessableEntityException({ code: 'no_agent', message: 'No team member is available to take appointments' });
      const data = await loadAvailability(tx, a.tenantId);
      const lp = localParts(tz, startsAt);
      const free = candidates.filter((m) => input.outsideHours || withinWorkingHours(data, m, tz, startsAt, endsAt, lp.date));
      if (free.length === 0) throw new UnprocessableEntityException({ code: 'outside_hours', message: 'That time is outside working hours' });
      // Least busy that day first (stable on the candidate order), so work spreads across the team.
      const counts = await tx.appointment.groupBy({ by: ['membershipId'], where: { membershipId: { in: free }, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gte: new Date(startsAt.getTime() - 12 * 3600_000), lt: new Date(startsAt.getTime() + 12 * 3600_000) } }, _count: true });
      const load = new Map(counts.map((c) => [c.membershipId, c._count]));
      const ordered = [...free].sort((x, y) => (load.get(x) ?? 0) - (load.get(y) ?? 0) || candidates.indexOf(x) - candidates.indexOf(y));
      return { lead, ordered };
    });

    let lastKind: 'agent' | 'lead' | null = null;
    for (const membershipId of plan.ordered) {
      try {
        const id = await this.tx(a, async (tx) => {
          const status = opts.status ?? (opts.source === 'manual' ? 'CONFIRMED' : 'PENDING');
          const visitNoun = packForIndustry((await tx.tenant.findUnique({ where: { id: a.tenantId }, select: { industryPackId: true } }))?.industryPackId ?? 'real_estate').terminology.visit;
          const created = await tx.appointment.create({ data: {
            id: uuidv7(), tenantId: a.tenantId, leadId: input.leadId, membershipId, propertyId: input.propertyId ?? null,
            title: input.title ?? `${visitNoun}: ${plan.lead.name}`, startsAt, endsAt, status, notes: input.notes ?? null, location: input.location ?? null, source: opts.source, createdByUserId: a.userId,
          } });
          await this.afterBooked(tx, a, created, 'booked');
          return created.id;
        });
        return this.get({ ...a, permissions: new Set([...a.permissions, 'appointment:read:all']) }, id);
      } catch (e) {
        const kind = overlapKind(e);
        if (!kind) throw e;
        if (kind === 'lead') throw new ConflictException({ code: 'lead_busy', message: 'This customer already has an appointment at that time' });
        lastKind = kind;
      }
    }
    throw new ConflictException({ code: 'slot_taken', message: lastKind === 'agent' ? 'That time was just taken. Please choose another slot.' : 'That time is not available' });
  }

  private async afterBooked(tx: TxClient, a: Actor, row: { id: string; leadId: string; membershipId: string; startsAt: Date; status: string; source: string }, kind: 'booked' | 'rescheduled', extra: Prisma.InputJsonObject = {}): Promise<void> {
    await tx.appointmentEvent.create({ data: { id: uuidv7(), tenantId: a.tenantId, appointmentId: row.id, type: kind === 'booked' ? 'created' : 'rescheduled_to', actorUserId: a.userId, data: { source: row.source, status: row.status, ...extra } } });
    await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId: row.leadId, type: 'appointment_booked', actorUserId: a.userId, data: { appointmentId: row.id, startsAt: row.startsAt.toISOString(), source: row.source } } });
    await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: `appointment.${kind}`, resourceType: 'appointment', resourceId: row.id, metadata: { source: row.source, ...(a.apiKeyId ? { apiKeyId: a.apiKeyId } : {}) }, ...(a.requestId ? { requestId: a.requestId } : {}), ...(a.ip ? { ip: a.ip } : {}) });
    await this.outbox.emit(tx, a.tenantId, kind === 'booked' ? 'appointment.booked' : 'appointment.rescheduled', { appointmentId: row.id, leadId: row.leadId, membershipId: row.membershipId, source: row.source, byUserId: a.userId });
  }

  // ------------------------------------------------------------------ lifecycle
  private async transition(a: Actor, id: string, to: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW', data: { reason?: string | undefined } = {}): Promise<AppointmentDto> {
    this.requireWrite(a);
    await this.tx(a, async (tx) => {
      const cur = await tx.appointment.findFirst({ where: { id } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Appointment not found' });
      this.assertOwnsOrAll(a, cur.membershipId);
      if (!(APPOINTMENT_TRANSITIONS[cur.status] as readonly string[]).includes(to)) throw new ConflictException({ code: 'invalid_transition', message: `A ${cur.status.toLowerCase().replace('_', ' ')} appointment cannot become ${to.toLowerCase().replace('_', ' ')}` });
      if ((to === 'COMPLETED' || to === 'NO_SHOW') && cur.startsAt.getTime() > Date.now()) throw new UnprocessableEntityException({ code: 'not_started', message: 'This appointment has not started yet' });
      // Compare-and-set on the previous status: two concurrent transitions cannot both win.
      const res = await tx.appointment.updateMany({ where: { id, status: cur.status }, data: { status: to, ...(to === 'CANCELLED' ? { cancelledReason: data.reason ?? null } : {}) } });
      if (res.count !== 1) throw new ConflictException({ code: 'invalid_transition', message: 'This appointment was just changed by someone else. Refresh and try again.' });
      await tx.appointmentEvent.create({ data: { id: uuidv7(), tenantId: a.tenantId, appointmentId: id, type: to.toLowerCase(), actorUserId: a.userId, data: { from: cur.status, ...(data.reason ? { reason: data.reason } : {}) } } });
      await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId: cur.leadId, type: `appointment_${to.toLowerCase()}`, actorUserId: a.userId, data: { appointmentId: id } } });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: `appointment.${to.toLowerCase()}`, resourceType: 'appointment', resourceId: id, metadata: {}, ...(a.requestId ? { requestId: a.requestId } : {}), ...(a.ip ? { ip: a.ip } : {}) });
      await this.outbox.emit(tx, a.tenantId, `appointment.${to.toLowerCase()}`, { appointmentId: id, leadId: cur.leadId, membershipId: cur.membershipId, byUserId: a.userId });
    });
    return this.get({ ...a, permissions: new Set([...a.permissions, 'appointment:read:all']) }, id);
  }
  confirm(a: Actor, id: string) { return this.transition(a, id, 'CONFIRMED'); }
  complete(a: Actor, id: string) { return this.transition(a, id, 'COMPLETED'); }
  noShow(a: Actor, id: string) { return this.transition(a, id, 'NO_SHOW'); }
  cancel(a: Actor, id: string, reason?: string) { return this.transition(a, id, 'CANCELLED', { reason }); }

  async update(a: Actor, id: string, input: { title?: string | undefined; notes?: string | null | undefined; location?: string | null | undefined }): Promise<AppointmentDto> {
    this.requireWrite(a);
    await this.tx(a, async (tx) => {
      const cur = await tx.appointment.findFirst({ where: { id } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Appointment not found' });
      this.assertOwnsOrAll(a, cur.membershipId);
      await tx.appointment.update({ where: { id }, data: { ...(input.title ? { title: input.title } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), ...(input.location !== undefined ? { location: input.location } : {}) } });
      await tx.appointmentEvent.create({ data: { id: uuidv7(), tenantId: a.tenantId, appointmentId: id, type: 'updated', actorUserId: a.userId, data: { fields: Object.keys(input) } } });
    });
    return this.get({ ...a, permissions: new Set([...a.permissions, 'appointment:read:all']) }, id);
  }

  /** The old appointment is released first (RESCHEDULED), then the new one is inserted, so a move that overlaps the old slot is legal. Both happen in one transaction. */
  async reschedule(a: Actor, id: string, input: { startsAt: string; durationMinutes?: number | undefined; membershipId?: string | undefined; reason?: string | undefined; outsideHours?: boolean | undefined }): Promise<AppointmentDto> {
    this.requireWrite(a);
    if (input.outsideHours && !this.canSeeAll(a)) throw new ForbiddenException({ code: 'forbidden', message: 'Only managers can book outside working hours' });
    const startsAt = new Date(input.startsAt);
    if (startsAt.getTime() < Date.now()) throw new UnprocessableEntityException({ code: 'in_the_past', message: 'That time has already passed' });
    let newId: string;
    try {
      newId = await this.tx(a, async (tx) => {
        const cur = await tx.appointment.findFirst({ where: { id } });
        if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Appointment not found' });
        this.assertOwnsOrAll(a, cur.membershipId);
        if (!(APPOINTMENT_TRANSITIONS[cur.status] as readonly string[]).includes('RESCHEDULED')) throw new ConflictException({ code: 'invalid_transition', message: 'This appointment can no longer be rescheduled' });
        const membershipId = input.membershipId ?? cur.membershipId;
        if (membershipId !== cur.membershipId) {
          if (!this.canSeeAll(a)) throw new ForbiddenException({ code: 'forbidden', message: 'Only managers can move an appointment to someone else' });
          if (!(await this.eligibleAgents(tx, a.tenantId)).includes(membershipId)) throw new BadRequestException({ code: 'invalid_agent', message: 'That team member cannot take appointments' });
        }
        const durationMs = input.durationMinutes ? input.durationMinutes * 60_000 : cur.endsAt.getTime() - cur.startsAt.getTime();
        const endsAt = new Date(startsAt.getTime() + durationMs);
        if (!input.outsideHours) {
          const tz = await this.tenantTz(tx, a.tenantId);
          if (!withinWorkingHours(await loadAvailability(tx, a.tenantId), membershipId, tz, startsAt, endsAt, localParts(tz, startsAt).date)) throw new UnprocessableEntityException({ code: 'outside_hours', message: 'That time is outside working hours' });
        }
        const res = await tx.appointment.updateMany({ where: { id, status: cur.status }, data: { status: 'RESCHEDULED' } });
        if (res.count !== 1) throw new ConflictException({ code: 'invalid_transition', message: 'This appointment was just changed by someone else. Refresh and try again.' });
        const created = await tx.appointment.create({ data: {
          id: uuidv7(), tenantId: a.tenantId, leadId: cur.leadId, membershipId, propertyId: cur.propertyId, title: cur.title, startsAt, endsAt, status: cur.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING',
          notes: cur.notes, location: cur.location, source: cur.source, rescheduledFromId: cur.id, createdByUserId: a.userId,
        } });
        await tx.appointmentEvent.create({ data: { id: uuidv7(), tenantId: a.tenantId, appointmentId: cur.id, type: 'rescheduled_from', actorUserId: a.userId, data: { toAppointmentId: created.id, ...(input.reason ? { reason: input.reason } : {}) } } });
        await this.afterBooked(tx, a, created, 'rescheduled', { fromAppointmentId: cur.id });
        return created.id;
      });
    } catch (e) {
      const kind = overlapKind(e);
      if (kind === 'lead') throw new ConflictException({ code: 'lead_busy', message: 'This customer already has an appointment at that time' });
      if (kind === 'agent') throw new ConflictException({ code: 'slot_taken', message: 'That time was just taken. Please choose another slot.' });
      throw e;
    }
    return this.get({ ...a, permissions: new Set([...a.permissions, 'appointment:read:all']) }, newId);
  }

  // ------------------------------------------------------------------ availability settings
  async getAvailability(a: Actor, membershipId: string | null) {
    this.requireRead(a);
    if (membershipId !== (a.membershipId ?? null) && !this.canSeeAll(a)) throw new ForbiddenException({ code: 'forbidden', message: 'You can only view your own availability' });
    return this.tx(a, async (tx) => {
      const rules = await tx.availabilityRule.findMany({ where: { membershipId }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] });
      const exceptions = await tx.availabilityException.findMany({ where: { membershipId }, orderBy: { date: 'asc' } });
      const tz = await this.tenantTz(tx, a.tenantId);
      return { timezone: tz, membershipId, usingDefault: rules.length === 0, rules: rules.map((r) => ({ dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute })), exceptions: exceptions.map((e) => ({ id: e.id, date: e.date, startMinute: e.startMinute, endMinute: e.endMinute, reason: e.reason })) };
    });
  }

  private canEditAvailability(a: Actor, membershipId: string | null): boolean {
    if (a.permissions.has('settings:manage')) return true;
    return membershipId !== null && membershipId === a.membershipId && a.permissions.has('appointment:write');
  }

  async replaceAvailability(a: Actor, membershipId: string | null, rules: { dayOfWeek: number; startMinute: number; endMinute: number }[]) {
    if (!this.canEditAvailability(a, membershipId)) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot change this availability' });
    await this.tx(a, async (tx) => {
      if (membershipId) { const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: a.tenantId }, select: { id: true } }); if (!m) throw new NotFoundException({ code: 'not_found', message: 'Team member not found' }); }
      await tx.availabilityRule.deleteMany({ where: { membershipId } });
      if (rules.length) await tx.availabilityRule.createMany({ data: rules.map((r) => ({ id: uuidv7(), tenantId: a.tenantId, membershipId, ...r })) });
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'availability.update', resourceType: 'availability', ...(membershipId ? { resourceId: membershipId } : {}), metadata: { rules: rules.length }, ...(a.requestId ? { requestId: a.requestId } : {}) });
    });
    return this.getAvailability({ ...a, permissions: new Set([...a.permissions, 'appointment:read:all']) }, membershipId);
  }

  async addException(a: Actor, input: { membershipId: string | null; date: string; startMinute?: number | null | undefined; endMinute?: number | null | undefined; reason?: string | null | undefined }) {
    if (!this.canEditAvailability(a, input.membershipId)) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot change this availability' });
    await this.tx(a, (tx) => tx.availabilityException.create({ data: { id: uuidv7(), tenantId: a.tenantId, membershipId: input.membershipId, date: input.date, startMinute: input.startMinute ?? null, endMinute: input.endMinute ?? null, reason: input.reason ?? null } }));
    return this.getAvailability({ ...a, permissions: new Set([...a.permissions, 'appointment:read:all']) }, input.membershipId);
  }

  async removeException(a: Actor, id: string) {
    await this.tx(a, async (tx) => {
      const ex = await tx.availabilityException.findFirst({ where: { id } });
      if (!ex) throw new NotFoundException({ code: 'not_found', message: 'Not found' });
      if (!this.canEditAvailability(a, ex.membershipId)) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot change this availability' });
      await tx.availabilityException.delete({ where: { id } });
    });
  }
}
