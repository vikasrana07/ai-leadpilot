import { RequireFeature } from '../common/billing-meta.js';
import { Body, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  bulkSchema, checkDuplicatesSchema, createLeadSchema, importSchema, leadListQuerySchema, mergeSchema, noteSchema, stageChangeSchema, tagsSchema, updateLeadSchema,
  type BulkInput, type CreateLeadInput, type ImportInput, type LeadListQuery, type StageChangeInput, type UpdateLeadInput,
} from '@leadpilot/validation';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LeadAttachmentsService, MAX_ATTACHMENT_BYTES } from './lead-attachments.service.js';
import { LeadImportService } from './lead-import.service.js';
import { LeadVoiceService } from './lead-voice.service.js';
import { LeadsService } from './leads.service.js';
import { z } from 'zod';

const applyVoiceSchema = z.object({
  note: z.string().trim().min(1).max(4000),
  updates: z
    .object({
      budgetMin: z.number().positive().optional(),
      budgetMax: z.number().positive().optional(),
      location: z.string().trim().max(120).optional(),
      propertyType: z.string().trim().max(80).optional(),
      buyingTimeline: z.enum(['IMMEDIATE', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'SIX_PLUS_MONTHS', 'UNKNOWN']).optional(),
      requirements: z.string().trim().max(2000).optional(),
    })
    .optional(),
  task: z
    .object({
      title: z.string().trim().min(1).max(200),
      dueAt: z.string().datetime({ offset: true }).optional(),
    })
    .optional(),
});

/**
 * Permission checks live in the service (they depend on row ownership: `own` vs `all`), so there is no blanket
 * @RequirePermissions here. Every handler passes an Actor derived from the validated membership.
 */
@Controller('leads')
export class LeadsController {
  constructor(
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(LeadImportService) private readonly imports: LeadImportService,
    @Inject(LeadAttachmentsService) private readonly attachments: LeadAttachmentsService,
    @Inject(LeadVoiceService) private readonly voice: LeadVoiceService,
  ) {}

  @Get() list(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(leadListQuerySchema)) q: LeadListQuery) { return this.leads.list(actorFrom(ctx), q); }

  @Post() @HttpCode(201)
  create(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(createLeadSchema)) body: CreateLeadInput) { return this.leads.create(actorFrom(ctx), body); }

  @Get('meta') meta(@CurrentTenant() ctx: TenantRequestContext) { return this.leads.meta(actorFrom(ctx)); }

  @Get('tags') tags(@CurrentTenant() ctx: TenantRequestContext) { return this.leads.listTags(actorFrom(ctx)); }

  @Post('check-duplicates') @HttpCode(200)
  check(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(checkDuplicatesSchema)) b: { phone?: string | null; email?: string | null; excludeId?: string }) {
    return this.leads.checkDuplicates(actorFrom(ctx), b.phone, b.email, b.excludeId);
  }

  @Post('bulk') @HttpCode(200)
  bulk(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(bulkSchema)) body: BulkInput) { return this.leads.bulk(actorFrom(ctx), body); }

  @Post('import') @HttpCode(200)
  import(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(importSchema)) body: ImportInput) { return this.imports.importCsv(actorFrom(ctx), body); }

  @Get('import-jobs/:jobId')
  async getImportJob(@CurrentTenant() ctx: TenantRequestContext, @Param('jobId', new ParseUUIDPipe()) jobId: string) {
    const job = await this.imports.getImportJob(actorFrom(ctx), jobId);
    if (!job) throw new NotFoundException({ code: 'not_found', message: 'Import job not found' });
    return job;
  }

  @Get('import-jobs/:jobId/errors')
  @Header('Cache-Control', 'no-store')
  async getImportErrors(@CurrentTenant() ctx: TenantRequestContext, @Param('jobId', new ParseUUIDPipe()) jobId: string, @Res() res: Response): Promise<void> {
    const csv = await this.imports.getImportErrorsCsv(actorFrom(ctx), jobId);
    if (!csv) throw new NotFoundException({ code: 'not_found', message: 'No error report available for this job' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-errors-${jobId}.csv"`);
    res.send(`\uFEFF${csv}`);
  }

  @Get('export') @RequireFeature('csv_export') @Header('Cache-Control', 'no-store')
  async export(@CurrentTenant() ctx: TenantRequestContext, @Query(new ZodPipe(leadListQuerySchema)) q: LeadListQuery, @Res() res: Response): Promise<void> {
    const csv = await this.imports.exportCsv(actorFrom(ctx), q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${csv}`);
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

  @Get(':id/attachments')
  listAttachments(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.attachments.list(actorFrom(ctx), id);
  }

  @Post(':id/attachments') @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES + 1, files: 1 } }))
  uploadAttachment(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
  ) {
    return this.attachments.upload(actorFrom(ctx), id, file);
  }

  @Get(':id/attachments/:attachmentId/download')
  async downloadAttachment(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.attachments.download(actorFrom(ctx), id, attachmentId);
    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${f.filename.replace(/[^\w.\- ]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(f.data);
  }

  @Delete(':id/attachments/:attachmentId') @HttpCode(204)
  removeAttachment(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
  ) {
    return this.attachments.remove(actorFrom(ctx), id, attachmentId);
  }

  @Post(':id/voice-note') @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  voiceNote(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
    @Body() body: { transcript?: string },
  ) {
    return this.voice.transcribeAndExtract(actorFrom(ctx), id, file, body?.transcript);
  }

  @Post(':id/voice-note/apply') @HttpCode(200)
  applyVoiceNote(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(applyVoiceSchema)) body: z.infer<typeof applyVoiceSchema>,
  ) {
    return this.voice.applyExtraction(actorFrom(ctx), id, {
      note: body.note,
      ...(body.updates ? { updates: body.updates } : {}),
      ...(body.task ? { task: body.task } : {}),
    });
  }
}
