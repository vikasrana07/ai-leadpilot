import { series } from '../common/series.js';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type Temperature, type TxClient } from '@leadpilot/database';
import type { BulkInput, CreateLeadInput, LeadListQuery, StageChangeInput, UpdateLeadInput } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { ScoringService } from '../ai/scoring/scoring.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { toMinor } from '../common/money.js';
import { normalizeEmail, normalizePhone } from '../common/phone.js';
import { DbService } from '../db/db.module.js';
import { LEAD_INCLUDE, toLeadDto, type LeadDto, type LeadRow } from './lead-mapper.js';
import { OutboxService, originOf } from '../ops/outbox.service.js';
import { RoundRobin } from './round-robin.js';
import { checkTransition } from './stage-rules.js';

export interface DuplicateInfo { id: string; name: string; phone: string | null; email: string | null; stage: string }

@Injectable()
export class LeadsService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService, @Inject(ScoringService) private readonly scoring: ScoringService, @Inject(OutboxService) private readonly outbox: OutboxService) {}

  // ------------------------------------------------------------------ access control
  /** Row-level scoping for reads: `lead:read:all` sees everything, `lead:read:own` only assigned leads. */
  readScope(a: Actor): Prisma.LeadWhereInput {
    if (a.permissions.has('lead:read:all')) return {};
    if (a.permissions.has('lead:read:own') && a.membershipId) return { assignedMembershipId: a.membershipId };
    throw new ForbiddenException({ code: 'forbidden', message: 'You do not have permission to view leads' });
  }

  private canWriteLead(a: Actor, lead: { assignedMembershipId: string | null }): boolean {
    if (a.permissions.has('lead:write:all')) return true;
    return a.permissions.has('lead:write:own') && a.membershipId !== null && lead.assignedMembershipId === a.membershipId;
  }

  private assertCanWrite(a: Actor, lead: { assignedMembershipId: string | null }): void {
    if (!this.canWriteLead(a, lead)) throw new ForbiddenException({ code: 'forbidden', message: 'You can only change leads assigned to you' });
  }

  // ------------------------------------------------------------------ helpers
  private async assigneeNames(tx: TxClient, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => x !== null))];
    if (unique.length === 0) return new Map();
    const ms = await tx.membership.findMany({ where: { id: { in: unique } }, select: { id: true, userId: true } });
    const users = await tx.user.findMany({ where: { id: { in: ms.map((m) => m.userId) } }, select: { id: true, name: true } });
    const byUser = new Map(users.map((u) => [u.id, u.name]));
    return new Map(ms.map((m) => [m.id, byUser.get(m.userId) ?? 'Unknown']));
  }

  private async dto(tx: TxClient, rows: LeadRow[]): Promise<LeadDto[]> {
    const names = await this.assigneeNames(tx, rows.map((r) => r.assignedMembershipId));
    return rows.map((r) => toLeadDto(r, names));
  }

  private async activity(tx: TxClient, a: Actor, leadId: string, type: string, data: Prisma.InputJsonObject = {}): Promise<void> {
    await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId, type, actorUserId: a.userId, data } });
  }

  private auditLead(tx: TxClient, a: Actor, action: string, leadId: string | null, metadata: Prisma.InputJsonObject = {}): Promise<unknown> {
    return this.audit.record(tx, {
      tenantId: a.tenantId, actorUserId: a.userId, action, resourceType: 'lead', ...(leadId ? { resourceId: leadId } : {}),
      metadata: a.apiKeyId ? { ...metadata, apiKeyId: a.apiKeyId } : metadata, ...(a.requestId ? { requestId: a.requestId } : {}), ...(a.ip ? { ip: a.ip } : {}),
    });
  }

  private async validateAssignee(tx: TxClient, a: Actor, id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const m = await tx.membership.findFirst({ where: { id, tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true } });
    if (!m) throw new BadRequestException({ code: 'invalid_assignee', message: 'That team member is not available for assignment' });
    return m.id;
  }

  private async cleanCustomFields(tx: TxClient, a: Actor, input: Record<string, string | number | boolean | null> | undefined, existing?: Prisma.JsonValue): Promise<Prisma.InputJsonObject | undefined> {
    if (input === undefined) return undefined;
    const defs = await tx.customFieldDefinition.findMany({ where: { tenantId: a.tenantId, entity: 'lead' } });
    const out: Record<string, string | number | boolean | null> = { ...((existing as Record<string, string | number | boolean | null> | null) ?? {}) };
    const details: { path: string; message: string }[] = [];
    for (const [key, value] of Object.entries(input)) {
      const def = defs.find((d) => d.key === key);
      if (!def) { details.push({ path: `customFields.${key}`, message: 'Unknown field' }); continue; }
      if (value === null || value === '') { delete out[key]; continue; }
      const options = Array.isArray(def.options) ? (def.options as string[]) : [];
      const ok = (def.type === 'number' && typeof value === 'number') || (def.type === 'boolean' && typeof value === 'boolean')
        || (def.type === 'select' && typeof value === 'string' && options.includes(value))
        || ((def.type === 'text' || def.type === 'date') && typeof value === 'string');
      if (!ok) details.push({ path: `customFields.${key}`, message: `Invalid value for ${def.label}` }); else out[key] = value;
    }
    for (const d of defs.filter((x) => x.required)) if (out[d.key] === undefined) details.push({ path: `customFields.${d.key}`, message: `${d.label} is required` });
    if (details.length) throw new BadRequestException({ code: 'validation_error', message: 'Invalid request', details });
    return out;
  }

  async findDuplicates(tx: TxClient, tenantId: string, phoneNorm: string | null, emailNorm: string | null, excludeId?: string): Promise<DuplicateInfo[]> {
    const or: Prisma.LeadWhereInput[] = [];
    if (phoneNorm) or.push({ phoneNorm });
    if (emailNorm) or.push({ emailNorm });
    if (or.length === 0) return [];
    const rows = await tx.lead.findMany({
      where: { tenantId, deletedAt: null, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true, phone: true, email: true, stage: { select: { name: true } } }, take: 5,
    });
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, stage: r.stage.name }));
  }

  private async firstStage(tx: TxClient, tenantId: string) {
    const s = await tx.pipelineStage.findFirst({ where: { tenantId, kind: 'OPEN' }, orderBy: { position: 'asc' } });
    if (!s) throw new UnprocessableEntityException({ code: 'no_pipeline', message: 'This workspace has no pipeline stages yet' });
    return s;
  }

  private async sourceId(tx: TxClient, tenantId: string, key: string | undefined, fallback: string): Promise<string | null> {
    const s = await tx.leadSource.findFirst({ where: { tenantId, OR: [{ key: key ?? fallback }, { key: fallback }] }, orderBy: { key: key ? 'asc' : 'desc' } });
    const exact = key ? await tx.leadSource.findFirst({ where: { tenantId, key } }) : null;
    return (exact ?? s)?.id ?? null;
  }

  // ------------------------------------------------------------------ queries
  buildWhere(a: Actor, q: Partial<LeadListQuery>): Prisma.LeadWhereInput {
    const and: Prisma.LeadWhereInput[] = [{ tenantId: a.tenantId, deletedAt: null }, this.readScope(a)];
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      and.push({ OR: [
        { name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } },
        ...(digits.length >= 3 ? [{ phoneNorm: { contains: digits } }] : []),
      ] });
    }
    if (q.stageId) {
      const ids = q.stageId.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length > 1) and.push({ stageId: { in: ids } });
      else if (ids[0]) and.push({ stageId: ids[0] });
    }
    if (q.kind) and.push({ stage: { kind: q.kind } });
    if (q.temperature) {
      const temps = q.temperature.split(',').map((s) => s.trim()).filter(Boolean);
      if (temps.length > 1) and.push({ temperature: { in: temps as Temperature[] } });
      else if (temps[0]) and.push({ temperature: temps[0] as Temperature });
    }
    if (q.sourceId) {
      const sources = q.sourceId.split(',').map((s) => s.trim()).filter(Boolean);
      if (sources.length > 1) and.push({ sourceId: { in: sources } });
      else if (sources[0]) and.push({ sourceId: sources[0] });
    }
    if (q.tagId) and.push({ tags: { some: { tagId: q.tagId } } });
    if (q.assigned) {
      const assignedList = q.assigned.split(',').map((s) => s.trim()).filter(Boolean);
      if (assignedList.length > 0) {
        const conditions: Prisma.LeadWhereInput[] = [];
        for (const item of assignedList) {
          if (item === 'unassigned') conditions.push({ assignedMembershipId: null });
          else if (item === 'me') conditions.push({ assignedMembershipId: a.membershipId ?? '00000000-0000-0000-0000-000000000000' });
          else conditions.push({ assignedMembershipId: item });
        }
        if (conditions.length === 1 && conditions[0]) {
          and.push(conditions[0]);
        } else if (conditions.length > 1) {
          and.push({ OR: conditions });
        }
      }
    }
    if (q.createdFrom) and.push({ createdAt: { gte: new Date(q.createdFrom) } });
    if (q.createdTo) and.push({ createdAt: { lte: new Date(q.createdTo) } });
    if (q.overdue === 'true') and.push({ nextFollowUpAt: { lt: new Date() }, stage: { kind: 'OPEN' } });
    return { AND: and };
  }

  async list(a: Actor, q: LeadListQuery) {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const where = this.buildWhere(a, q);
      const orderBy: Prisma.LeadOrderByWithRelationInput[] =
        q.sort === 'name' ? [{ name: q.dir }, { id: 'asc' }]
        : q.sort === 'score' || q.sort === 'nextFollowUpAt' ? [{ [q.sort]: { sort: q.dir, nulls: 'last' } }, { id: 'asc' }]
        : [{ [q.sort]: q.dir }, { id: 'asc' }];
      const [total, rows] = await series([ () => tx.lead.count({ where }), () => tx.lead.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: LEAD_INCLUDE })]);
      return { items: await this.dto(tx, rows), total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(a: Actor, id: string) {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const row = await tx.lead.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) }, include: LEAD_INCLUDE });
      if (!row) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const merged = await tx.lead.findMany({ where: { mergedIntoId: id }, select: { id: true, name: true } });
      const [dto] = await this.dto(tx, [row]);
      return { ...(dto as LeadDto), mergedLeads: merged, canWrite: this.canWriteLead(a, row) };
    });
  }

  // ------------------------------------------------------------------ create / update / delete
  /** Shared by the API, CSV import fallbacks and API-key capture. Must run inside a tenant transaction. */
  async createInTx(tx: TxClient, a: Actor, input: CreateLeadInput, opts: { defaultSource: string; rr?: RoundRobin } = { defaultSource: 'manual' }): Promise<{ lead: LeadRow; duplicates: DuplicateInfo[] }> {
    const phone = normalizePhone(input.phone);
    if (input.phone && !phone) throw new BadRequestException({ code: 'validation_error', message: 'Invalid request', details: [{ path: 'phone', message: 'Enter a valid phone number' }] });
    const emailNorm = normalizeEmail(input.email);
    const duplicates = await this.findDuplicates(tx, a.tenantId, phone?.norm ?? null, emailNorm);
    if (duplicates.length && !input.allowDuplicate) throw new ConflictException({ code: 'duplicate_lead', message: 'A lead with this phone or email already exists', details: duplicates });

    let assignee = await this.validateAssignee(tx, a, input.assignedMembershipId);
    if (!input.assignedMembershipId) {
      if (!a.permissions.has('lead:write:all') && a.membershipId) assignee = a.membershipId; // agents own what they create
      else { const rr = opts.rr ?? (await RoundRobin.load(tx, a.tenantId)); assignee = rr.next(); if (!opts.rr) await rr.save(tx); }
    } else if (!a.permissions.has('lead:assign') && !a.permissions.has('lead:write:all') && input.assignedMembershipId !== a.membershipId) {
      throw new ForbiddenException({ code: 'forbidden', message: 'You cannot assign leads to other people' });
    }
    const stage = await this.firstStage(tx, a.tenantId);
    const customFields = await this.cleanCustomFields(tx, a, input.customFields ?? {});
    const id = uuidv7();
    await tx.lead.create({
      data: {
        id, tenantId: a.tenantId, name: input.name, phone: phone?.display ?? null, phoneNorm: phone?.norm ?? null,
        email: input.email ?? null, emailNorm, sourceId: await this.sourceId(tx, a.tenantId, input.sourceKey, opts.defaultSource), stageId: stage.id,
        temperature: 'UNKNOWN', budgetMinMinor: toMinor(input.budgetMin), budgetMaxMinor: toMinor(input.budgetMax),
        location: input.location ?? null, propertyType: input.propertyType ?? null, requirements: input.requirements ?? null,
        buyingTimeline: input.buyingTimeline ?? 'UNKNOWN', assignedMembershipId: assignee,
        nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null, customFields: customFields ?? {}, createdByUserId: a.userId,
      },
    });
    await this.activity(tx, a, id, 'created', { source: opts.defaultSource });
    if (assignee) await this.activity(tx, a, id, 'assigned', { to: assignee });
    await this.auditLead(tx, a, 'lead.created', id, { assigned: assignee !== null });
    await this.outbox.emit(tx, a.tenantId, 'lead.created', { leadId: id, ...originOf(a) });
    if (assignee) await this.outbox.emit(tx, a.tenantId, 'lead.assigned', { leadId: id, membershipId: assignee, byUserId: a.userId, ...originOf(a) });
    await this.scoring.rescore(tx, a.tenantId, id, a.userId);
    const lead = await tx.lead.findUniqueOrThrow({ where: { id }, include: LEAD_INCLUDE });
    return { lead, duplicates };
  }

  async create(a: Actor, input: CreateLeadInput): Promise<LeadDto> {
    if (!a.permissions.has('lead:write:all') && !a.permissions.has('lead:write:own')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot create leads' });
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const { lead } = await this.createInTx(tx, a, input);
      return (await this.dto(tx, [lead]))[0] as LeadDto;
    });
  }

  async update(a: Actor, id: string, input: UpdateLeadInput): Promise<LeadDto> {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const cur = await tx.lead.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) } });
      if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      this.assertCanWrite(a, cur);
      const data: Prisma.LeadUncheckedUpdateInput = {};
      const changed: string[] = [];
      const set = <K extends keyof Prisma.LeadUncheckedUpdateInput>(k: K, v: Prisma.LeadUncheckedUpdateInput[K], label: string) => { data[k] = v; changed.push(label); };
      if (input.name !== undefined && input.name !== cur.name) set('name', input.name, 'name');
      if (input.phone !== undefined) {
        const p = normalizePhone(input.phone);
        if (input.phone && !p) throw new BadRequestException({ code: 'validation_error', message: 'Invalid request', details: [{ path: 'phone', message: 'Enter a valid phone number' }] });
        if ((p?.display ?? null) !== cur.phone) { data.phone = p?.display ?? null; data.phoneNorm = p?.norm ?? null; changed.push('phone'); }
      }
      if (input.email !== undefined && (input.email ?? null) !== cur.email) { data.email = input.email ?? null; data.emailNorm = normalizeEmail(input.email); changed.push('email'); }
      if (input.budgetMin !== undefined) set('budgetMinMinor', toMinor(input.budgetMin), 'budgetMin');
      if (input.budgetMax !== undefined) set('budgetMaxMinor', toMinor(input.budgetMax), 'budgetMax');
      if (input.location !== undefined && input.location !== cur.location) set('location', input.location, 'location');
      if (input.propertyType !== undefined && input.propertyType !== cur.propertyType) set('propertyType', input.propertyType, 'propertyType');
      if (input.requirements !== undefined && input.requirements !== cur.requirements) set('requirements', input.requirements, 'requirements');
      if (input.buyingTimeline !== undefined && input.buyingTimeline !== cur.buyingTimeline) set('buyingTimeline', input.buyingTimeline, 'buyingTimeline');
      if (input.nextFollowUpAt !== undefined) set('nextFollowUpAt', input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null, 'nextFollowUpAt');
      if (input.sourceKey) { const sid = await this.sourceId(tx, a.tenantId, input.sourceKey, 'manual'); if (sid !== cur.sourceId) set('sourceId', sid, 'source'); }
      if (input.customFields !== undefined) set('customFields', await this.cleanCustomFields(tx, a, input.customFields, cur.customFields) ?? {}, 'customFields');
      const min = input.budgetMin !== undefined ? input.budgetMin : cur.budgetMinMinor === null ? null : Number(cur.budgetMinMinor) / 100;
      const max = input.budgetMax !== undefined ? input.budgetMax : cur.budgetMaxMinor === null ? null : Number(cur.budgetMaxMinor) / 100;
      if (min != null && max != null && min > max) throw new BadRequestException({ code: 'validation_error', message: 'Invalid request', details: [{ path: 'budgetMin', message: 'Minimum budget cannot exceed maximum' }] });

      if (input.assignedMembershipId !== undefined && input.assignedMembershipId !== cur.assignedMembershipId) {
        if (!a.permissions.has('lead:assign')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot reassign leads' });
        data.assignedMembershipId = await this.validateAssignee(tx, a, input.assignedMembershipId);
        await this.activity(tx, a, id, 'assigned', { from: cur.assignedMembershipId, to: data.assignedMembershipId as string | null });
        await this.auditLead(tx, a, 'lead.assigned', id, { from: cur.assignedMembershipId, to: data.assignedMembershipId as string | null });
        if (data.assignedMembershipId) await this.outbox.emit(tx, a.tenantId, 'lead.assigned', { leadId: id, membershipId: data.assignedMembershipId as string, byUserId: a.userId, ...originOf(a) });
      }
      if (changed.length || data.assignedMembershipId !== undefined) {
        const phoneNorm = (data.phoneNorm as string | null | undefined) ?? cur.phoneNorm;
        const emailNorm = (data.emailNorm as string | null | undefined) ?? cur.emailNorm;
        if ((data.phoneNorm !== undefined || data.emailNorm !== undefined) && !(phoneNorm || emailNorm)) throw new BadRequestException({ code: 'validation_error', message: 'Invalid request', details: [{ path: 'phone', message: 'A lead needs a phone number or an email' }] });
        await tx.lead.update({ where: { id }, data });
        await this.scoring.rescore(tx, a.tenantId, id, a.userId);
        if (changed.length) { await this.activity(tx, a, id, 'updated', { fields: changed }); await this.auditLead(tx, a, 'lead.updated', id, { fields: changed }); }
      }
      const row = await tx.lead.findUniqueOrThrow({ where: { id }, include: LEAD_INCLUDE });
      return (await this.dto(tx, [row]))[0] as LeadDto;
    });
  }

  async remove(a: Actor, id: string): Promise<void> {
    if (!a.permissions.has('lead:delete')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot delete leads' });
    await this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const r = await tx.lead.updateMany({ where: { id, tenantId: a.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      await this.auditLead(tx, a, 'lead.deleted', id);
    });
  }

  // ------------------------------------------------------------------ pipeline stage changes
  async applyStage(tx: TxClient, a: Actor, lead: { id: string; stageId: string; assignedMembershipId: string | null }, input: StageChangeInput): Promise<void> {
    this.assertCanWrite(a, lead);
    const stages = await tx.pipelineStage.findMany({ where: { tenantId: a.tenantId }, orderBy: { position: 'asc' } });
    const from = stages.find((s) => s.id === lead.stageId);
    const to = stages.find((s) => s.id === input.stageId);
    if (!from || !to) throw new NotFoundException({ code: 'not_found', message: 'Stage not found' });
    let reason: { id: string } | null = null;
    if (to.kind === 'LOST' && input.lostReasonId) reason = await tx.lostReason.findFirst({ where: { id: input.lostReasonId, tenantId: a.tenantId, active: true }, select: { id: true } });
    const nextWinnable = stages.find((s) => s.kind === 'OPEN' && s.canCloseWon && s.position > from.position);
    const check = checkTransition(from, to, { canReopen: a.permissions.has('lead:write:all'), hasLostReason: reason !== null, nextWinnableName: nextWinnable?.name });
    if (!check.ok) {
      const body = { code: check.code, message: check.message };
      if (check.status === 403) throw new ForbiddenException(body);
      if (check.status === 422) throw new UnprocessableEntityException(body);
      throw new BadRequestException(body);
    }
    await tx.lead.update({ where: { id: lead.id }, data: { stageId: to.id, lostReasonId: to.kind === 'LOST' ? reason?.id ?? null : null, lostNote: to.kind === 'LOST' ? input.lostNote ?? null : null } });
    await tx.stageTransition.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId: lead.id, fromStageId: from.id, toStageId: to.id, lostReasonId: reason?.id ?? null, actorUserId: a.userId } });
    await this.activity(tx, a, lead.id, 'stage_changed', { from: from.name, to: to.name, ...(reason ? { lostReasonId: reason.id } : {}) });
    await this.auditLead(tx, a, 'lead.stage_changed', lead.id, { from: from.name, to: to.name });
    await this.outbox.emit(tx, a.tenantId, 'lead.stage_changed', { leadId: lead.id, fromStage: from.key, toStage: to.key, toKind: to.kind, ...originOf(a) });
  }

  async changeStage(a: Actor, id: string, input: StageChangeInput): Promise<LeadDto> {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      await this.applyStage(tx, a, lead, input);
      const row = await tx.lead.findUniqueOrThrow({ where: { id }, include: LEAD_INCLUDE });
      return (await this.dto(tx, [row]))[0] as LeadDto;
    });
  }

  // ------------------------------------------------------------------ bulk
  async bulk(a: Actor, input: BulkInput) {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const leads = await tx.lead.findMany({ where: { id: { in: input.ids }, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) } });
      const found = new Map(leads.map((l) => [l.id, l]));
      const skipped: { id: string; reason: string }[] = [];
      let updated = 0;
      if (input.action === 'assign' && !a.permissions.has('lead:assign')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot assign leads' });
      if (input.action === 'delete' && !a.permissions.has('lead:delete')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot delete leads' });
      const assignee = input.action === 'assign' ? await this.validateAssignee(tx, a, input.assignedMembershipId) : null;
      for (const id of input.ids) {
        const lead = found.get(id);
        if (!lead) { skipped.push({ id, reason: 'Not found' }); continue; }
        try {
          if (input.action === 'delete') { await tx.lead.update({ where: { id }, data: { deletedAt: new Date() } }); await this.auditLead(tx, a, 'lead.deleted', id, { bulk: true }); }
          else {
            this.assertCanWrite(a, lead);
            if (input.action === 'assign') {
              await tx.lead.update({ where: { id }, data: { assignedMembershipId: assignee } });
              await this.activity(tx, a, id, 'assigned', { from: lead.assignedMembershipId, to: assignee });
              if (assignee) await this.outbox.emit(tx, a.tenantId, 'lead.assigned', { leadId: id, membershipId: assignee, byUserId: a.userId, ...originOf(a) });
              await this.auditLead(tx, a, 'lead.assigned', id, { bulk: true, to: assignee });
            } else if (input.action === 'stage') {
              // savepoint so one invalid transition does not abort the whole batch
              await tx.$executeRawUnsafe('SAVEPOINT bulk_item');
              try { await this.applyStage(tx, a, lead, { stageId: input.stageId, ...(input.lostReasonId ? { lostReasonId: input.lostReasonId } : {}), ...(input.lostNote ? { lostNote: input.lostNote } : {}) }); await tx.$executeRawUnsafe('RELEASE SAVEPOINT bulk_item'); }
              catch (e) { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT bulk_item'); throw e; }
            } else {
              await this.setTagsTx(tx, a, id, { add: input.add, remove: input.remove });
            }
          }
          updated++;
        } catch (e) {
          skipped.push({ id, reason: e instanceof Error ? ((e as { response?: { message?: string } }).response?.message ?? e.message) : 'Failed' });
        }
      }
      return { updated, skipped };
    });
  }

  // ------------------------------------------------------------------ tags & notes & timeline
  private async setTagsTx(tx: TxClient, a: Actor, leadId: string, change: { add?: string[]; remove?: string[]; replace?: string[] }): Promise<void> {
    const ensure = async (names: string[]) => {
      const ids: string[] = [];
      for (const raw of names) {
        const name = raw.trim();
        const t = await tx.tag.upsert({ where: { tenantId_name: { tenantId: a.tenantId, name } }, create: { id: uuidv7(), tenantId: a.tenantId, name }, update: {} });
        ids.push(t.id);
      }
      return ids;
    };
    if (change.replace) {
      const ids = await ensure(change.replace);
      await tx.leadTag.deleteMany({ where: { leadId, tagId: { notIn: ids } } });
      for (const tagId of ids) await tx.leadTag.upsert({ where: { leadId_tagId: { leadId, tagId } }, create: { tenantId: a.tenantId, leadId, tagId }, update: {} });
    }
    if (change.add?.length) for (const tagId of await ensure(change.add)) await tx.leadTag.upsert({ where: { leadId_tagId: { leadId, tagId } }, create: { tenantId: a.tenantId, leadId, tagId }, update: {} });
    if (change.remove?.length) {
      const tags = await tx.tag.findMany({ where: { tenantId: a.tenantId, name: { in: change.remove } }, select: { id: true } });
      await tx.leadTag.deleteMany({ where: { leadId, tagId: { in: tags.map((t) => t.id) } } });
    }
    await this.activity(tx, a, leadId, 'tags_changed', { ...(change.add ? { added: change.add } : {}), ...(change.remove ? { removed: change.remove } : {}), ...(change.replace ? { set: change.replace } : {}) });
  }

  async setTags(a: Actor, id: string, names: string[]): Promise<LeadDto> {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      this.assertCanWrite(a, lead);
      await this.setTagsTx(tx, a, id, { replace: names });
      return (await this.dto(tx, [await tx.lead.findUniqueOrThrow({ where: { id }, include: LEAD_INCLUDE })]))[0] as LeadDto;
    });
  }

  /** Lookup data for forms and filters: sources, tags and the tenant's custom field definitions. */
  meta(a: Actor) {
    return this.db.tenantTx({ tenantId: a.tenantId }, async (tx) => {
      const [sources, tags, customFields] = await series([ () => tx.leadSource.findMany({ where: { tenantId: a.tenantId }, orderBy: { name: 'asc' }, select: { id: true, key: true, name: true } }), () => tx.tag.findMany({ where: { tenantId: a.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, color: true } }), () => tx.customFieldDefinition.findMany({ where: { tenantId: a.tenantId, entity: 'lead' }, orderBy: { position: 'asc' }, select: { key: true, label: true, type: true, options: true, required: true } })]);
      return { sources, tags, customFields };
    });
  }

  listTags(a: Actor) {
    return this.db.tenantTx({ tenantId: a.tenantId }, (tx) => tx.tag.findMany({ where: { tenantId: a.tenantId }, orderBy: { name: 'asc' } }));
  }

  async addNote(a: Actor, id: string, body: string) {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      this.assertCanWrite(a, lead);
      if (!a.userId) throw new ForbiddenException({ code: 'forbidden', message: 'Notes need a signed-in author' });
      const note = await tx.leadNote.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId: id, authorUserId: a.userId, body } });
      await tx.lead.update({ where: { id }, data: { lastContactedAt: lead.lastContactedAt } }); // touch updatedAt only
      await this.activity(tx, a, id, 'note_added', { noteId: note.id, preview: body.slice(0, 120) });
      return { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() };
    });
  }

  /** Notes and history include those of leads merged into this one (history rows are append-only and are not moved). */
  private async relatedIds(tx: TxClient, id: string): Promise<string[]> {
    const merged = await tx.lead.findMany({ where: { mergedIntoId: id }, select: { id: true } });
    return [id, ...merged.map((m) => m.id)];
  }

  async notes(a: Actor, id: string) {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      if (!(await tx.lead.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) }, select: { id: true } }))) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const rows = await tx.leadNote.findMany({ where: { leadId: { in: await this.relatedIds(tx, id) } }, orderBy: { createdAt: 'desc' }, take: 200 });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorUserId))] } }, select: { id: true, name: true } });
      const names = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => ({ id: r.id, body: r.body, author: names.get(r.authorUserId) ?? 'Unknown', createdAt: r.createdAt.toISOString() }));
    });
  }

  async timeline(a: Actor, id: string) {
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      if (!(await tx.lead.findFirst({ where: { id, tenantId: a.tenantId, deletedAt: null, ...this.readScope(a) }, select: { id: true } }))) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const rows = await tx.leadActivity.findMany({ where: { leadId: { in: await this.relatedIds(tx, id) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => x !== null))] } }, select: { id: true, name: true } });
      const names = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => ({ id: r.id, type: r.type, data: r.data, actor: r.actorUserId ? names.get(r.actorUserId) ?? 'Unknown' : null, createdAt: r.createdAt.toISOString() }));
    });
  }

  // ------------------------------------------------------------------ duplicates & merge
  async checkDuplicates(a: Actor, phone: string | null | undefined, email: string | null | undefined, excludeId?: string) {
    return this.db.tenantTx({ tenantId: a.tenantId }, (tx) => this.findDuplicates(tx, a.tenantId, normalizePhone(phone)?.norm ?? null, normalizeEmail(email), excludeId));
  }

  async merge(a: Actor, targetId: string, sourceIds: string[]): Promise<LeadDto> {
    if (!a.permissions.has('lead:write:all')) throw new ForbiddenException({ code: 'forbidden', message: 'Only managers can merge leads' });
    if (sourceIds.includes(targetId)) throw new BadRequestException({ code: 'invalid_merge', message: 'A lead cannot be merged into itself' });
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const target = await tx.lead.findFirst({ where: { id: targetId, tenantId: a.tenantId, deletedAt: null }, include: { tags: true } });
      const sources = await tx.lead.findMany({ where: { id: { in: sourceIds }, tenantId: a.tenantId, deletedAt: null }, include: { tags: true }, orderBy: { createdAt: 'asc' } });
      if (!target || sources.length !== new Set(sourceIds).size) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const fill: Prisma.LeadUncheckedUpdateInput = {};
      for (const s of sources) {
        // The target wins; only empty fields are filled from the duplicates.
        if (!target.phone && !fill.phone && s.phone) { fill.phone = s.phone; fill.phoneNorm = s.phoneNorm; }
        if (!target.email && !fill.email && s.email) { fill.email = s.email; fill.emailNorm = s.emailNorm; }
        if (!target.location && !fill.location && s.location) fill.location = s.location;
        if (!target.propertyType && !fill.propertyType && s.propertyType) fill.propertyType = s.propertyType;
        if (!target.requirements && !fill.requirements && s.requirements) fill.requirements = s.requirements;
        if (target.budgetMinMinor === null && fill.budgetMinMinor === undefined && s.budgetMinMinor !== null) fill.budgetMinMinor = s.budgetMinMinor;
        if (target.budgetMaxMinor === null && fill.budgetMaxMinor === undefined && s.budgetMaxMinor !== null) fill.budgetMaxMinor = s.budgetMaxMinor;
        if (target.buyingTimeline === 'UNKNOWN' && fill.buyingTimeline === undefined && s.buyingTimeline !== 'UNKNOWN') fill.buyingTimeline = s.buyingTimeline;
        if (!target.assignedMembershipId && fill.assignedMembershipId === undefined && s.assignedMembershipId) fill.assignedMembershipId = s.assignedMembershipId;
        if (s.lastContactedAt && (!target.lastContactedAt || s.lastContactedAt > target.lastContactedAt)) fill.lastContactedAt = s.lastContactedAt;
      }
      if (Object.keys(fill).length) await tx.lead.update({ where: { id: targetId }, data: fill });
      const have = new Set(target.tags.map((t) => t.tagId));
      for (const s of sources) for (const t of s.tags) if (!have.has(t.tagId)) { have.add(t.tagId); await tx.leadTag.create({ data: { tenantId: a.tenantId, leadId: targetId, tagId: t.tagId } }); }
      await tx.lead.updateMany({ where: { id: { in: sourceIds } }, data: { deletedAt: new Date(), mergedIntoId: targetId } });
      await this.activity(tx, a, targetId, 'merged', { sourceIds, sourceNames: sources.map((s) => s.name) });
      await this.auditLead(tx, a, 'lead.merged', targetId, { sourceIds });
      return (await this.dto(tx, [await tx.lead.findUniqueOrThrow({ where: { id: targetId }, include: LEAD_INCLUDE })]))[0] as LeadDto;
    });
  }
}
