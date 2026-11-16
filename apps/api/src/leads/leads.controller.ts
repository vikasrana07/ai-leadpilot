import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  bulkSchema, checkDuplicatesSchema, createLeadSchema, importSchema, leadListQuerySchema, mergeSchema, noteSchema, stageChangeSchema, tagsSchema, updateLeadSchema,
  type BulkInput, type CreateLeadInput, type ImportInput, type LeadListQuery, type StageChangeInput, type UpdateLeadInput,
} from '@leadpilot/validation';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LeadImportService } from './lead-import.service.js';
import { LeadsService } from './leads.service.js';

/**
 * Permission checks live in the service (they depend on row ownership: `own` vs `all`), so there is no blanket
 * @RequirePermissions here. Every handler passes an Actor derived from the validated membership.
 */
@Controller('leads')
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService, @Inject(LeadImportService) private readonly imports: LeadImportService) {}

  @Get() list(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(leadListQuerySchema)) q: LeadListQuery) { return this.leads.list(actorFrom(ctx), q); }

  @Post() @HttpCode(201)
  create(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(createLeadSchema)) body: CreateLeadInput) { return this.leads.create(actorFrom(ctx), body); }

  @Get('tags') tags(@CurrentTenant() ctx: TenantRequestContext) { return this.leads.listTags(actorFrom(ctx)); }

  @Post('check-duplicates') @HttpCode(200)
  check(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(checkDuplicatesSchema)) b: { phone?: string | null; email?: string | null; excludeId?: string }) {
    return this.leads.checkDuplicates(actorFrom(ctx), b.phone, b.email, b.excludeId);
  }

  @Post('bulk') @HttpCode(200)
  bulk(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(bulkSchema)) body: BulkInput) { return this.leads.bulk(actorFrom(ctx), body); }

  @Post('import') @HttpCode(200)
  import(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(importSchema)) body: ImportInput) { return this.imports.importCsv(actorFrom(ctx), body); }

  @Get('export') @Header('Cache-Control', 'no-store')
  async export(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(leadListQuerySchema)) q: LeadListQuery, @Res() res: Response): Promise<void> {
    const csv = await this.imports.exportCsv(actorFrom(ctx), q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${csv}`);
  }

  @Get(':id') get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.leads.get(actorFrom(ctx), id); }

  @Patch(':id')
  update(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(updateLeadSchema)) body: UpdateLeadInput) { return this.leads.update(actorFrom(ctx), id, body); }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.leads.remove(actorFrom(ctx), id); }

  @Post(':id/stage') @HttpCode(200)
  stage(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(stageChangeSchema)) body: StageChangeInput) { return this.leads.changeStage(actorFrom(ctx), id, body); }

  @Put(':id/tags')
  tagsSet(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(tagsSchema)) body: { names: string[] }) { return this.leads.setTags(actorFrom(ctx), id, body.names); }

  @Get(':id/notes') notes(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.leads.notes(actorFrom(ctx), id); }

  @Post(':id/notes') @HttpCode(201)
  addNote(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(noteSchema)) body: { body: string }) { return this.leads.addNote(actorFrom(ctx), id, body.body); }

  @Get(':id/activity') activity(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.leads.timeline(actorFrom(ctx), id); }

  @Post(':id/merge') @HttpCode(200)
  merge(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(mergeSchema)) body: { sourceIds: string[] }) { return this.leads.merge(actorFrom(ctx), id, body.sourceIds); }
}
