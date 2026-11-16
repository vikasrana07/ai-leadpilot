import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { documentUpdateSchema, knowledgeSearchSchema } from '@leadpilot/validation';
import type { z } from 'zod';
import { CurrentTenant, RequirePermissions } from '../../common/decorators.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { KnowledgeService, MAX_UPLOAD_BYTES } from './knowledge.service.js';

@Controller('knowledge')
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly svc: KnowledgeService) {}

  @Get('documents') @RequirePermissions('knowledge:manage') list(@CurrentTenant() c: TenantRequestContext) { return this.svc.list(c); }

  @Post('documents') @HttpCode(201) @RequirePermissions('knowledge:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1 } }))
  upload(@CurrentTenant() c: TenantRequestContext, @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined, @Body() body: { title?: string; category?: string }) {
    return this.svc.upload(c, file, { ...(typeof body?.title === 'string' ? { title: body.title.slice(0, 160) } : {}), ...(typeof body?.category === 'string' ? { category: body.category.slice(0, 60) } : {}) });
  }

  @Post('search') @HttpCode(200) @RequirePermissions('knowledge:manage')
  search(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(knowledgeSearchSchema)) b: z.infer<typeof knowledgeSearchSchema>) { return this.svc.search(c.tenantId, b.q, b.limit); }

  @Get('documents/:id') @RequirePermissions('knowledge:manage') get(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.get(c, id); }
  @Patch('documents/:id') @RequirePermissions('knowledge:manage') update(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(documentUpdateSchema)) b: z.infer<typeof documentUpdateSchema>) { return this.svc.update(c, id, b); }
  @Post('documents/:id/reprocess') @HttpCode(202) @RequirePermissions('knowledge:manage') reprocess(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.reprocess(c, id); }
  @Delete('documents/:id') @HttpCode(204) @RequirePermissions('knowledge:manage') remove(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.remove(c, id); }

  @Get('documents/:id/download') @RequirePermissions('knowledge:manage')
  async download(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const f = await this.svc.download(c, id);
    res.set({ 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${f.filename.replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'private, no-store' });
    res.send(f.data);
  }
}
