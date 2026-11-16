import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  leadListQuerySchema, lostReasonSchema, lostReasonUpdateSchema, stageCreateSchema, stageReorderSchema, stageUpdateSchema,
} from '@leadpilot/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { LEAD_INCLUDE, toLeadDto } from '../leads/lead-mapper.js';
import { LeadsModule } from '../leads/leads.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { v7 as uuidv7 } from 'uuid';

const boardQuery = leadListQuerySchema.pick({ q: true, temperature: true, assigned: true, sourceId: true, tagId: true, overdue: true });
type BoardQuery = z.infer<typeof boardQuery>;
const CARDS_PER_STAGE = 30;

@Injectable()
export class PipelineService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LeadsService) private readonly leads: LeadsService,
  ) {}

  private rec(ctx: TenantRequestContext, tx: Parameters<AuditService['record']>[0], action: string, id: string | null, metadata: Record<string, string | number | boolean> = {}) {
    return this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action, resourceType: 'pipeline_stage', ...(id ? { resourceId: id } : {}), metadata, requestId: ctx.requestId, ip: ctx.ip });
  }

  async stages(ctx: TenantRequestContext) {
    const a = actorFrom(ctx);
    return this.db.tenantTx(ctx, async (tx) => {
      const [stages, reasons, counts] = await Promise.all([
        tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } }),
        tx.lostReason.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } }),
        tx.lead.groupBy({ by: ['stageId'], where: this.leads.buildWhere(a, {}), _count: { _all: true } }),
      ]);
      const byStage = new Map(counts.map((c) => [c.stageId, c._count._all]));
      return {
        stages: stages.map((s) => ({ id: s.id, key: s.key, name: s.name, position: s.position, kind: s.kind, qualifies: s.qualifies, canCloseWon: s.canCloseWon, leadCount: byStage.get(s.id) ?? 0 })),
        lostReasons: reasons.map((r) => ({ id: r.id, name: r.name, active: r.active })),
      };
    });
  }

  async board(ctx: TenantRequestContext, q: BoardQuery) {
    const a = actorFrom(ctx);
    return this.db.tenantTx(ctx, async (tx) => {
      const stages = await tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } });
      const base = this.leads.buildWhere(a, { ...q, sort: 'createdAt', dir: 'desc', page: 1, pageSize: CARDS_PER_STAGE });
      const cols = [];
      for (const s of stages) {
        const where = { AND: [base, { stageId: s.id }] };
        const [total, rows] = await Promise.all([tx.lead.count({ where }), tx.lead.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: CARDS_PER_STAGE, include: LEAD_INCLUDE })]);
        const names = new Map<string, string>();
        const ms = await tx.membership.findMany({ where: { id: { in: rows.map((r) => r.assignedMembershipId).filter((x): x is string => x !== null) } }, select: { id: true, userId: true } });
        const us = await tx.user.findMany({ where: { id: { in: ms.map((m) => m.userId) } }, select: { id: true, name: true } });
        ms.forEach((m) => names.set(m.id, us.find((u) => u.id === m.userId)?.name ?? 'Unknown'));
        cols.push({ stage: { id: s.id, key: s.key, name: s.name, kind: s.kind, position: s.position }, total, leads: rows.map((r) => toLeadDto(r, names)) });
      }
      return { columns: cols };
    });
  }

  createStage(ctx: TenantRequestContext, input: z.infer<typeof stageCreateSchema>) {
    return this.db.tenantTx(ctx, async (tx) => {
      const stages = await tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } });
      if (stages.length >= 20) throw new BadRequestException({ code: 'too_many_stages', message: 'A pipeline can have up to 20 stages' });
      const firstClosed = stages.find((s) => s.kind !== 'OPEN');
      const position = firstClosed ? firstClosed.position : stages.length;
      for (const s of stages.filter((x) => x.position >= position).reverse()) await tx.pipelineStage.update({ where: { id: s.id }, data: { position: s.position + 1 } });
      const key = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'stage'}_${Math.random().toString(36).slice(2, 6)}`;
      const created = await tx.pipelineStage.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, key, name: input.name, position, kind: 'OPEN', qualifies: input.qualifies, canCloseWon: input.canCloseWon } });
      await this.rec(ctx, tx, 'pipeline.stage_created', created.id, { name: input.name });
      return created;
    });
  }

  updateStage(ctx: TenantRequestContext, id: string, input: z.infer<typeof stageUpdateSchema>) {
    return this.db.tenantTx(ctx, async (tx) => {
      const s = await tx.pipelineStage.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!s) throw new NotFoundException({ code: 'not_found', message: 'Stage not found' });
      const data = { ...(input.name !== undefined ? { name: input.name } : {}), ...(s.kind === 'OPEN' && input.qualifies !== undefined ? { qualifies: input.qualifies } : {}), ...(s.kind === 'OPEN' && input.canCloseWon !== undefined ? { canCloseWon: input.canCloseWon } : {}) };
      const updated = await tx.pipelineStage.update({ where: { id }, data });
      await this.rec(ctx, tx, 'pipeline.stage_updated', id, { fields: Object.keys(data).join(',') });
      return updated;
    });
  }

  reorder(ctx: TenantRequestContext, ids: string[]) {
    return this.db.tenantTx(ctx, async (tx) => {
      const stages = await tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId } });
      if (ids.length !== stages.length || new Set(ids).size !== ids.length || !ids.every((i) => stages.some((s) => s.id === i))) throw new BadRequestException({ code: 'invalid_order', message: 'Provide every stage exactly once' });
      const kinds = ids.map((i) => stages.find((s) => s.id === i)?.kind);
      const firstClosed = kinds.findIndex((k) => k !== 'OPEN');
      if (firstClosed !== -1 && kinds.slice(firstClosed).some((k) => k === 'OPEN')) throw new BadRequestException({ code: 'invalid_order', message: 'Won and Lost stages must stay at the end' });
      for (const [position, id] of ids.entries()) await tx.pipelineStage.update({ where: { id }, data: { position } });
      await this.rec(ctx, tx, 'pipeline.stages_reordered', null);
    });
  }

  deleteStage(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const s = await tx.pipelineStage.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!s) throw new NotFoundException({ code: 'not_found', message: 'Stage not found' });
      if (s.kind !== 'OPEN') throw new BadRequestException({ code: 'stage_protected', message: 'Won and Lost stages cannot be removed' });
      if ((await tx.pipelineStage.count({ where: { tenantId: ctx.tenantId, kind: 'OPEN' } })) <= 1) throw new BadRequestException({ code: 'last_stage', message: 'Keep at least one open stage' });
      if ((await tx.lead.count({ where: { stageId: id } })) > 0) throw new BadRequestException({ code: 'stage_in_use', message: 'Move the leads in this stage elsewhere first' });
      await tx.pipelineStage.delete({ where: { id } });
      const rest = await tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } });
      for (const [position, st] of rest.entries()) if (st.position !== position) await tx.pipelineStage.update({ where: { id: st.id }, data: { position } });
      await this.rec(ctx, tx, 'pipeline.stage_deleted', id, { name: s.name });
    });
  }

  addReason(ctx: TenantRequestContext, name: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const count = await tx.lostReason.count({ where: { tenantId: ctx.tenantId } });
      try { return await tx.lostReason.create({ data: { id: uuidv7(), tenantId: ctx.tenantId, name, position: count } }); }
      catch { throw new BadRequestException({ code: 'duplicate_reason', message: 'That reason already exists' }); }
    });
  }

  updateReason(ctx: TenantRequestContext, id: string, input: z.infer<typeof lostReasonUpdateSchema>) {
    return this.db.tenantTx(ctx, async (tx) => {
      const r = await tx.lostReason.updateMany({ where: { id, tenantId: ctx.tenantId }, data: input });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'Reason not found' });
      return tx.lostReason.findUniqueOrThrow({ where: { id } });
    });
  }
}

@Controller('pipeline')
class PipelineController {
  constructor(@Inject(PipelineService) private readonly svc: PipelineService) {}
  @Get('stages') stages(@CurrentTenant() ctx: TenantRequestContext) { return this.svc.stages(ctx); }
  @Get('board') board(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(boardQuery)) q: BoardQuery) { return this.svc.board(ctx, q); }
  @Post('stages') @HttpCode(201) @RequirePermissions('pipeline:manage')
  create(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(stageCreateSchema)) b: z.infer<typeof stageCreateSchema>) { return this.svc.createStage(ctx, b); }
  @Post('stages/reorder') @HttpCode(204) @RequirePermissions('pipeline:manage')
  reorder(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(stageReorderSchema)) b: { ids: string[] }) { return this.svc.reorder(ctx, b.ids); }
  @Patch('stages/:id') @RequirePermissions('pipeline:manage')
  update(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(stageUpdateSchema)) b: z.infer<typeof stageUpdateSchema>) { return this.svc.updateStage(ctx, id, b); }
  @Delete('stages/:id') @HttpCode(204) @RequirePermissions('pipeline:manage')
  remove(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.deleteStage(ctx, id); }
  @Post('lost-reasons') @HttpCode(201) @RequirePermissions('pipeline:manage')
  addReason(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(lostReasonSchema)) b: { name: string }) { return this.svc.addReason(ctx, b.name); }
  @Patch('lost-reasons/:id') @RequirePermissions('pipeline:manage')
  updateReason(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(lostReasonUpdateSchema)) b: z.infer<typeof lostReasonUpdateSchema>) { return this.svc.updateReason(ctx, id, b); }
}

@Module({ imports: [LeadsModule], controllers: [PipelineController], providers: [PipelineService] })
export class PipelineModule {}
