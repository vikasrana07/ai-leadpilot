import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { conversationAssignSchema, conversationListSchema, conversationTagsSchema, noteSchema, sendMessageSchema } from '@leadpilot/validation';
import type { z } from 'zod';
import { actorFrom } from '../common/actor.js';
import { CurrentTenant } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ConversationsService } from './conversations.service.js';
import { CannedResponsesService } from './canned-responses.service.js';

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/;

@Controller('conversations')
export class ConversationsController {
  constructor(
    @Inject(ConversationsService) private readonly svc: ConversationsService,
    @Inject(CannedResponsesService) private readonly canned: CannedResponsesService,
  ) {}

  @Get('canned-responses')
  listCannedResponses(@CurrentTenant() c: TenantRequestContext) {
    return this.canned.list(c);
  }

  @Post('canned-responses')
  @HttpCode(201)
  createCannedResponse(
    @CurrentTenant() c: TenantRequestContext,
    @Body() b: { shortcut: string; title: string; body: string; category?: string },
  ) {
    return this.canned.create(c, b);
  }

  @Delete('canned-responses/:id')
  @HttpCode(204)
  deleteCannedResponse(@CurrentTenant() c: TenantRequestContext, @Param('id') id: string) {
    return this.canned.delete(c, id);
  }

  @Get() list(@CurrentTenant() c: TenantRequestContext, @Query(new ZodPipe(conversationListSchema)) q: z.infer<typeof conversationListSchema>) { return this.svc.list(actorFrom(c), q); }
  @Get(':id') get(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.get(actorFrom(c), id); }
  @Get(':id/messages') messages(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Query('before') before?: string) { return this.svc.messages(actorFrom(c), id, before && /^[0-9a-f-]{36}$/i.test(before) ? before : undefined); }
  @Post(':id/messages') @HttpCode(201) send(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(sendMessageSchema)) b: z.infer<typeof sendMessageSchema>) { return this.svc.send(actorFrom(c), id, b); }
  @Post(':id/messages/:mid/retry') @HttpCode(200) retry(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Param('mid', new ParseUUIDPipe()) mid: string) { return this.svc.retry(actorFrom(c), id, mid); }
  @Post(':id/read') @HttpCode(204) read(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.markRead(actorFrom(c), id); }
  @Post(':id/assign') @HttpCode(204) assign(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(conversationAssignSchema)) b: { assignedMembershipId: string | null }) { return this.svc.assign(actorFrom(c), id, b.assignedMembershipId); }
  @Post(':id/close') @HttpCode(204) close(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.close(actorFrom(c), id); }
  @Post(':id/reopen') @HttpCode(204) reopen(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.reopen(actorFrom(c), id); }
  @Post(':id/takeover') @HttpCode(204) takeover(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.takeover(actorFrom(c), id); }
  @Post(':id/handback') @HttpCode(204) handback(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.handback(actorFrom(c), id); }
  @Get(':id/notes') notes(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.notes(actorFrom(c), id); }
  @Post(':id/notes') @HttpCode(201) addNote(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(noteSchema)) b: { body: string }) { return this.svc.addNote(actorFrom(c), id, b.body); }
  @Put(':id/tags') @HttpCode(204) tags(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(conversationTagsSchema)) b: { tags: string[] }) { return this.svc.setTags(actorFrom(c), id, b.tags); }

  /** Media is fetched from the provider on demand. Only common image types render inline; everything else downloads. */
  @Get(':id/messages/:mid/media')
  async media(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Param('mid', new ParseUUIDPipe()) mid: string, @Res() res: Response): Promise<void> {
    const f = await this.svc.media(actorFrom(c), id, mid);
    const inline = IMAGE_MIME.test(f.mime);
    res.set({ 'Content-Type': inline ? f.mime : 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${(f.filename ?? 'file').replace(/[^\w.\- ]/g, '_')}"` });
    res.send(f.data);
  }
}
