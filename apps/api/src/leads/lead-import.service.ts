import { series } from '../common/series.js';
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { BuyingTimeline, Prisma } from '@leadpilot/database';
import { leadFieldsSchema, TIMELINES, type ImportInput, type LeadListQuery } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { formatCsv, parseCsv } from '../common/csv.js';
import { fromMinor, toMinor } from '../common/money.js';
import { normalizeEmail, normalizePhone } from '../common/phone.js';
import { DbService } from '../db/db.module.js';
import { LeadsService } from './leads.service.js';
import { RoundRobin } from './round-robin.js';

const MAX_ROWS = 5000;

const ALIASES: Record<string, string> = {
  name: 'name', 'full name': 'name', fullname: 'name', customer: 'name', 'customer name': 'name', 'lead name': 'name',
  phone: 'phone', mobile: 'phone', 'mobile number': 'phone', 'phone number': 'phone', contact: 'phone', whatsapp: 'phone',
  email: 'email', 'email id': 'email', 'e-mail': 'email',
  source: 'source', 'lead source': 'source',
  stage: 'stage', status: 'stage',
  'budget min': 'budgetMin', 'min budget': 'budgetMin', budget_min: 'budgetMin', budget: 'budgetMin',
  'budget max': 'budgetMax', 'max budget': 'budgetMax', budget_max: 'budgetMax',
  location: 'location', city: 'location', area: 'location', locality: 'location',
  'property type': 'propertyType', property_type: 'propertyType', type: 'propertyType', configuration: 'propertyType',
  requirements: 'requirements', requirement: 'requirements', notes: 'requirements', remarks: 'requirements',
  timeline: 'timeline', 'buying timeline': 'timeline',
  tags: 'tags', 'assigned to': 'assignedTo', assignee: 'assignedTo', 'agent email': 'assignedTo', 'assigned_to': 'assignedTo',
};

/** Parses amounts such as "85,00,000", "₹1.2 Cr", "85 L", "50k" into rupees. */
export function parseMoney(raw: string): number | null {
  const m = raw.trim().toLowerCase().replace(/[₹,\s]/g, '').replace(/^rs\.?/, '').match(/^(\d+(?:\.\d+)?)(cr|crore|l|lac|lakh|lakhs|k)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { cr: 1e7, crore: 1e7, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, k: 1e3 }[m[2] ?? ''] ?? 1;
  return Math.round(n * mult);
}

const TIMELINE_ALIASES: Record<string, BuyingTimeline> = {
  immediate: 'IMMEDIATE', immediately: 'IMMEDIATE', 'within 30 days': 'WITHIN_30_DAYS', '30 days': 'WITHIN_30_DAYS', '1 month': 'WITHIN_30_DAYS',
  '1-3 months': 'ONE_TO_THREE_MONTHS', '1 to 3 months': 'ONE_TO_THREE_MONTHS', '3-6 months': 'THREE_TO_SIX_MONTHS', '3 to 6 months': 'THREE_TO_SIX_MONTHS',
  '6+ months': 'SIX_PLUS_MONTHS', '6 months+': 'SIX_PLUS_MONTHS',
};

export interface ImportRowError { row: number; errors: string[] }
export interface ImportReport {
  dryRun: boolean; totalRows: number; valid: number; invalid: ImportRowError[];
  duplicates: { row: number; reason: 'existing' | 'in_file'; existingLeadId?: string }[];
  unknownColumns: string[]; created: number; skipped: number;
}

@Injectable()
export class LeadImportService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LeadsService) private readonly leads: LeadsService,
  ) {}

  async importCsv(a: Actor, input: ImportInput): Promise<ImportReport> {
    if (!a.permissions.has('lead:import')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot import leads' });
    const rows = parseCsv(input.csv);
    if (rows.length < 2) throw new BadRequestException({ code: 'empty_csv', message: 'The file needs a header row and at least one lead' });
    if (rows.length - 1 > MAX_ROWS) throw new BadRequestException({ code: 'too_many_rows', message: `Import up to ${MAX_ROWS} leads at a time` });

    const header = (rows[0] as string[]).map((h) => h.trim().toLowerCase());
    const unknownColumns: string[] = [];
    const colField = header.map((h, i) => {
      if (h.startsWith('cf:')) return `cf:${h.slice(3)}`;
      const f = ALIASES[h];
      if (!f && h) unknownColumns.push((rows[0] as string[])[i]?.trim() ?? h);
      return f;
    });
    if (!colField.includes('name')) throw new BadRequestException({ code: 'missing_name_column', message: 'The file needs a "name" column' });

    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const [stages, sources, members, defs] = await series([ () => tx.pipelineStage.findMany({ where: { tenantId: a.tenantId } }), () => tx.leadSource.findMany({ where: { tenantId: a.tenantId } }), () => tx.membership.findMany({ where: { tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true, userId: true } }), () => tx.customFieldDefinition.findMany({ where: { tenantId: a.tenantId, entity: 'lead' } })]);
      const users = await tx.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, email: true } });
      const memberByEmail = new Map(members.map((m) => [users.find((u) => u.id === m.userId)?.email.toLowerCase() ?? '', m.id]));
      const defaultStage = stages.filter((s) => s.kind === 'OPEN').sort((x, y) => x.position - y.position)[0];
      if (!defaultStage) throw new BadRequestException({ code: 'no_pipeline', message: 'This workspace has no pipeline stages yet' });
      const canAssign = a.permissions.has('lead:assign') || a.permissions.has('lead:write:all');

      interface Parsed { row: number; data: ReturnType<typeof leadFieldsSchema.parse>; phoneNorm: string | null; emailNorm: string | null; stageId: string; sourceId: string | null; assignee: string | null; tags: string[]; timeline: BuyingTimeline; custom: Record<string, string | number | boolean> }
      const valid: Parsed[] = [];
      const invalid: ImportRowError[] = [];

      rows.slice(1).forEach((cells, idx) => {
        const rowNo = idx + 2;
        const get = (f: string) => { const i = colField.indexOf(f); return i >= 0 ? (cells[i] ?? '').trim() : ''; };
        const errors: string[] = [];
        const bMin = get('budgetMin'); const bMax = get('budgetMax');
        const minV = bMin ? parseMoney(bMin) : null; const maxV = bMax ? parseMoney(bMax) : null;
        if (bMin && minV === null) errors.push(`Budget "${bMin}" is not a valid amount`);
        if (bMax && maxV === null) errors.push(`Max budget "${bMax}" is not a valid amount`);
        const phoneRaw = get('phone'); const phone = normalizePhone(phoneRaw);
        if (phoneRaw && !phone) errors.push(`Phone "${phoneRaw}" is not valid`);
        const parsed = leadFieldsSchema.safeParse({ name: get('name'), phone: phone?.display ?? null, email: get('email') || null, location: get('location') || null, propertyType: get('propertyType') || null, requirements: get('requirements') || null, budgetMin: minV, budgetMax: maxV });
        if (!parsed.success) errors.push(...parsed.error.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`));
        if (parsed.success && !parsed.data.phone && !parsed.data.email) errors.push('Needs a phone number or an email');
        if (parsed.success && minV !== null && maxV !== null && minV > maxV) errors.push('Minimum budget exceeds maximum');
        const stageName = get('stage').toLowerCase();
        const stage = stageName ? stages.find((s) => s.name.toLowerCase() === stageName || s.key === stageName) : defaultStage;
        if (!stage) errors.push(`Unknown stage "${get('stage')}"`);
        else if (stage.kind !== 'OPEN') errors.push('Import leads into an open stage; mark them won or lost afterwards');
        const srcName = get('source').toLowerCase();
        const source = srcName ? sources.find((s) => s.key === srcName || s.name.toLowerCase() === srcName) : sources.find((s) => s.key === 'csv_import');
        if (srcName && !source) errors.push(`Unknown source "${get('source')}"`);
        const tl = get('timeline'); const tlKey = tl.toUpperCase().replace(/[\s-]+/g, '_');
        const timeline = !tl ? 'UNKNOWN' : (TIMELINES as readonly string[]).includes(tlKey) ? (tlKey as BuyingTimeline) : TIMELINE_ALIASES[tl.toLowerCase()];
        if (tl && !timeline) errors.push(`Unknown timeline "${tl}"`);
        const assignedEmail = get('assignedTo').toLowerCase();
        const assignee = assignedEmail ? memberByEmail.get(assignedEmail) ?? null : null;
        if (assignedEmail && !assignee) errors.push(`"${assignedEmail}" is not an active team member`);
        if (assignedEmail && !canAssign) errors.push('You cannot assign leads');
        const custom: Record<string, string | number | boolean> = {};
        colField.forEach((f, i) => {
          if (!f?.startsWith('cf:')) return;
          const key = f.slice(3); const def = defs.find((d) => d.key === key); const v = (cells[i] ?? '').trim();
          if (!def) { if (!unknownColumns.includes(`cf:${key}`)) unknownColumns.push(`cf:${key}`); return; }
          if (!v) return;
          if (def.type === 'number') { const n = Number(v); if (Number.isNaN(n)) errors.push(`${def.label} must be a number`); else custom[key] = n; }
          else if (def.type === 'boolean') custom[key] = ['yes', 'true', '1', 'y'].includes(v.toLowerCase());
          else if (def.type === 'select' && !((def.options as string[]) ?? []).includes(v)) errors.push(`${def.label}: "${v}" is not an allowed option`);
          else custom[key] = v;
        });
        if (errors.length || !parsed.success || !stage) { invalid.push({ row: rowNo, errors }); return; }
        valid.push({ row: rowNo, data: parsed.data, phoneNorm: phone?.norm ?? null, emailNorm: normalizeEmail(parsed.data.email), stageId: stage.id, sourceId: source?.id ?? null, assignee, tags: get('tags').split(/[;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 10), timeline: timeline ?? 'UNKNOWN', custom });
      });

      // duplicates: against the database and within the file
      const phones = valid.map((v) => v.phoneNorm).filter((x): x is string => x !== null);
      const emails = valid.map((v) => v.emailNorm).filter((x): x is string => x !== null);
      const existing = await tx.lead.findMany({ where: { tenantId: a.tenantId, deletedAt: null, OR: [{ phoneNorm: { in: phones } }, { emailNorm: { in: emails } }] }, select: { id: true, phoneNorm: true, emailNorm: true } });
      const byPhone = new Map(existing.filter((e) => e.phoneNorm).map((e) => [e.phoneNorm as string, e.id]));
      const byEmail = new Map(existing.filter((e) => e.emailNorm).map((e) => [e.emailNorm as string, e.id]));
      const seen = new Set<string>();
      const duplicates: ImportReport['duplicates'] = [];
      const toCreate: Parsed[] = [];
      for (const v of valid) {
        const ex = (v.phoneNorm && byPhone.get(v.phoneNorm)) || (v.emailNorm && byEmail.get(v.emailNorm)) || undefined;
        const keys = [v.phoneNorm && `p:${v.phoneNorm}`, v.emailNorm && `e:${v.emailNorm}`].filter((k): k is string => Boolean(k));
        const inFile = keys.some((k) => seen.has(k));
        keys.forEach((k) => seen.add(k));
        if (ex) duplicates.push({ row: v.row, reason: 'existing', existingLeadId: ex });
        else if (inFile) duplicates.push({ row: v.row, reason: 'in_file' });
        if ((ex || inFile) && input.duplicateStrategy === 'skip') continue;
        toCreate.push(v);
      }
      const report: ImportReport = { dryRun: input.dryRun, totalRows: rows.length - 1, valid: valid.length, invalid, duplicates, unknownColumns, created: 0, skipped: valid.length - toCreate.length };
      if (input.dryRun || toCreate.length === 0) return report;

      const rr = await RoundRobin.load(tx, a.tenantId);
      const ids = toCreate.map(() => uuidv7());
      await tx.lead.createMany({
        data: toCreate.map((v, i): Prisma.LeadCreateManyInput => ({
          id: ids[i] as string, tenantId: a.tenantId, name: v.data.name, phone: v.data.phone, phoneNorm: v.phoneNorm, email: v.data.email, emailNorm: v.emailNorm,
          sourceId: v.sourceId, stageId: v.stageId, budgetMinMinor: toMinor(v.data.budgetMin), budgetMaxMinor: toMinor(v.data.budgetMax),
          location: v.data.location, propertyType: v.data.propertyType, requirements: v.data.requirements, buyingTimeline: v.timeline,
          assignedMembershipId: v.assignee ?? rr.next(), customFields: v.custom, createdByUserId: a.userId,
        })),
      });
      await rr.save(tx);
      await tx.leadActivity.createMany({ data: ids.map((id) => ({ id: uuidv7(), tenantId: a.tenantId, leadId: id, type: 'created', actorUserId: a.userId, data: { source: 'csv_import' } })) });
      const tagNames = [...new Set(toCreate.flatMap((v) => v.tags))];
      if (tagNames.length) {
        const tagIds = new Map<string, string>();
        for (const name of tagNames) tagIds.set(name, (await tx.tag.upsert({ where: { tenantId_name: { tenantId: a.tenantId, name } }, create: { id: uuidv7(), tenantId: a.tenantId, name }, update: {} })).id);
        await tx.leadTag.createMany({ data: toCreate.flatMap((v, i) => v.tags.map((t) => ({ tenantId: a.tenantId, leadId: ids[i] as string, tagId: tagIds.get(t) as string }))), skipDuplicates: true });
      }
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'lead.imported', resourceType: 'lead', metadata: { created: toCreate.length, skipped: report.skipped, invalid: invalid.length }, ...(a.requestId ? { requestId: a.requestId } : {}), ...(a.ip ? { ip: a.ip } : {}) });
      report.created = toCreate.length;
      return report;
    });
  }

  async exportCsv(a: Actor, q: LeadListQuery): Promise<string> {
    if (!a.permissions.has('lead:export')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot export leads' });
    const where = this.leads.buildWhere(a, q);
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const rows = await tx.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50_000, include: { stage: true, source: true, tags: { select: { tag: { select: { name: true } } } } } });
      const members = await tx.membership.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assignedMembershipId).filter((x): x is string => x !== null))] } }, select: { id: true, userId: true } });
      const users = await tx.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, email: true } });
      const emailByMember = new Map(members.map((m) => [m.id, users.find((u) => u.id === m.userId)?.email ?? '']));
      await this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action: 'lead.exported', resourceType: 'lead', metadata: { rows: rows.length }, ...(a.requestId ? { requestId: a.requestId } : {}), ...(a.ip ? { ip: a.ip } : {}) });
      return formatCsv([
        ['name', 'phone', 'email', 'source', 'stage', 'temperature', 'budget_min', 'budget_max', 'location', 'property_type', 'timeline', 'score', 'assigned_to', 'tags', 'next_follow_up', 'created_at', 'requirements'],
        ...rows.map((r) => [r.name, r.phone, r.email, r.source?.name, r.stage.name, r.temperature, fromMinor(r.budgetMinMinor), fromMinor(r.budgetMaxMinor), r.location, r.propertyType, r.buyingTimeline, r.score, r.assignedMembershipId ? emailByMember.get(r.assignedMembershipId) : '', r.tags.map((t) => t.tag.name).join(';'), r.nextFollowUpAt?.toISOString(), r.createdAt.toISOString(), r.requirements]),
      ]);
    });
  }
}
