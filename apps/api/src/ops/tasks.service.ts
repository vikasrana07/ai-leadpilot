import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';

@Injectable()
export class TasksService {
  constructor(@Inject(DbService) private readonly db: DbService) {}
  private tx<T>(a: Actor, fn: (tx: TxClient) => Promise<T>): Promise<T> { return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, fn); }
  private seeAll(a: Actor): boolean { return a.permissions.has('lead:read:all'); }
  private requireAccess(a: Actor): void { if (!this.seeAll(a) && !(a.permissions.has('lead:read:own') && a.membershipId)) throw new ForbiddenException({ code: 'forbidden', message: 'You do not have permission to view tasks' }); }

  private async dtos(tx: TxClient, rows: Prisma.TaskGetPayload<object>[]) {
    const leads = await tx.lead.findMany({ where: { id: { in: rows.flatMap((r) => (r.leadId ? [r.leadId] : [])) } }, select: { id: true, name: true } });
    const ms = await tx.membership.findMany({ where: { id: { in: rows.flatMap((r) => (r.assigneeMembershipId ? [r.assigneeMembershipId] : [])) } }, select: { id: true, user: { select: { name: true } } } });
    const L = new Map(leads.map((l) => [l.id, l.name])); const M = new Map(ms.map((m) => [m.id, m.user.name]));
    return rows.map((r) => ({ id: r.id, title: r.title, notes: r.notes, status: r.status, dueAt: r.dueAt?.toISOString() ?? null, overdue: r.status === 'OPEN' && r.dueAt !== null && r.dueAt.getTime() < Date.now(), leadId: r.leadId, leadName: r.leadId ? L.get(r.leadId) ?? null : null, assigneeMembershipId: r.assigneeMembershipId, assigneeName: r.assigneeMembershipId ? M.get(r.assigneeMembershipId) ?? null : null, source: r.source, createdAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null }));
  }

  async list(a: Actor, q: { status?: 'OPEN' | 'DONE' | undefined; leadId?: string | undefined; mine?: 'true' | 'false' | undefined; limit: number }) {
    this.requireAccess(a);
    return this.tx(a, async (tx) => {
      const onlyMine = !this.seeAll(a) || q.mine === 'true';
      const rows = await tx.task.findMany({ where: { tenantId: a.tenantId, ...(q.status ? { status: q.status } : {}), ...(q.leadId ? { leadId: q.leadId } : {}), ...(onlyMine ? { assigneeMembershipId: a.membershipId ?? '00000000-0000-0000-0000-000000000000' } : {}) }, orderBy: [{ status: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: q.limit });
      return { items: await this.dtos(tx, rows) };
    });
  }

  async create(a: Actor, input: { title: string; leadId?: string | null | undefined; assigneeMembershipId?: string | null | undefined; dueAt?: string | null | undefined; notes?: string | null | undefined }) {
    if (!a.permissions.has('lead:write:all') && !a.permissions.has('lead:write:own')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot create tasks' });
    return this.tx(a, async (tx) => {
      if (input.leadId) {
        const lead = await tx.lead.findFirst({ where: { id: input.leadId, deletedAt: null }, select: { assignedMembershipId: true } });
        if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
        if (!a.permissions.has('lead:write:all') && lead.assignedMembershipId !== a.membershipId) throw new ForbiddenException({ code: 'forbidden', message: 'You can only add tasks to your own leads' });
      }
      let assignee = input.assigneeMembershipId ?? a.membershipId;
      if (input.assigneeMembershipId && input.assigneeMembershipId !== a.membershipId) {
        if (!a.permissions.has('lead:assign')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot assign tasks to other people' });
        if (!(await tx.membership.findFirst({ where: { id: input.assigneeMembershipId, tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true } }))) throw new BadRequestException({ code: 'invalid_assignee', message: 'That team member is not available' });
      }
      assignee = assignee ?? null;
      const t = await tx.task.create({ data: { id: uuidv7(), tenantId: a.tenantId, leadId: input.leadId ?? null, assigneeMembershipId: assignee, title: input.title, notes: input.notes ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null, source: 'manual' } });
      return (await this.dtos(tx, [t]))[0];
    });
  }

  async update(a: Actor, id: string, input: { title?: string | undefined; dueAt?: string | null | undefined; notes?: string | null | undefined; status?: 'OPEN' | 'DONE' | undefined; assigneeMembershipId?: string | null | undefined }) {
    this.requireAccess(a);
    return this.tx(a, async (tx) => {
      const cur = await tx.task.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!cur || (!this.seeAll(a) && cur.assigneeMembershipId !== a.membershipId)) throw new NotFoundException({ code: 'not_found', message: 'Task not found' });
      if (input.assigneeMembershipId !== undefined && !a.permissions.has('lead:assign')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot reassign tasks' });
      const done = input.status === 'DONE' && cur.status !== 'DONE';
      const t = await tx.task.update({ where: { id }, data: {
        ...(input.title ? { title: input.title } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), ...(input.assigneeMembershipId !== undefined ? { assigneeMembershipId: input.assigneeMembershipId } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null, remindedAt: null } : {}),
        ...(input.status ? { status: input.status, completedAt: input.status === 'DONE' ? (done ? new Date() : cur.completedAt) : null } : {}),
      } });
      return (await this.dtos(tx, [t]))[0];
    });
  }

  async remove(a: Actor, id: string): Promise<void> {
    this.requireAccess(a);
    await this.tx(a, async (tx) => {
      const cur = await tx.task.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!cur || (!this.seeAll(a) && cur.assigneeMembershipId !== a.membershipId)) throw new NotFoundException({ code: 'not_found', message: 'Task not found' });
      await tx.task.delete({ where: { id } });
    });
  }
}
