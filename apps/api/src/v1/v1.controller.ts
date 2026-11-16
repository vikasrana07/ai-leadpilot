import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  appointmentCreateSchema, appointmentListQuerySchema, conversationListSchema, createLeadSchema, leadListQuerySchema, noteSchema, stageChangeSchema, updateLeadSchema, v1ListQuerySchema,
  type AppointmentCreateInput, type CreateLeadInput, type StageChangeInput, type UpdateLeadInput, type V1ListQuery,
} from '@leadpilot/validation';
import { z } from 'zod';
import type { Actor } from '../common/actor.js';
import { Public } from '../common/decorators.js';
import type { AppRequest } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { LeadsService } from '../leads/leads.service.js';
import { AppointmentsService } from '../ops/appointments.service.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { RequireScope, SCOPE_PERMISSIONS } from './v1-meta.js';
import type { ApiScope } from '@leadpilot/validation';

const uuid = () => new ParseUUIDPipe();

/** The machine actor for a key: only the permissions its scopes grant, in its own tenant, attributed to the key in audit logs. */
function actorOf(req: AppRequest, opts: { author?: boolean } = {}): Actor {
  const k = req.apiKey;
  if (!k) throw new Error('ApiKeyGuard missing');
  const perms = new Set<string>(k.scopes.flatMap((s) => SCOPE_PERMISSIONS[s as ApiScope] ?? []));
  return { tenantId: k.tenantId, userId: opts.author ? k.createdBy : null, membershipId: null, permissions: perms, requestId: req.requestId, ip: req.ip, apiKeyId: k.id };
}
const list = <T>(r: { items: T[]; total: number; page: number; pageSize: number }) => ({ data: r.items, page: r.page, limit: r.pageSize, total: r.total });

/**
 * Public REST API, version 1. Authenticated with an API key (`Authorization: Bearer lp_live_...`), not a login session. `@Public()` only turns
 * off the SESSION guards; ApiKeyGuard protects every route here. Responses use `{ data }` envelopes; errors use the standard `{ error }` format.
 */
@Public() @Controller('v1') @UseGuards(ApiKeyGuard) @UseInterceptors(IdempotencyInterceptor)
export class V1Controller {
  constructor(
    @Inject(LeadsService) private readonly leads: LeadsService, @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
  ) {}

  @Get('me') me(@Req() req: AppRequest) { return { data: { keyId: req.apiKey?.id, tenantId: req.apiKey?.tenantId, scopes: req.apiKey?.scopes } }; }

  // ------------------------------------------------------------------ leads
  @Get('meta') @RequireScope('leads:read') async meta(@Req() req: AppRequest) { return { data: await this.leads.meta(actorOf(req)) }; }

  @Get('leads') @RequireScope('leads:read')
  async listLeads(@Req() req: AppRequest, @Query(new ZodPipe(v1ListQuerySchema)) q: V1ListQuery) {
    const { limit, ...rest } = q;
    return list(await this.leads.list(actorOf(req), leadListQuerySchema.parse({ ...rest, pageSize: limit })));
  }

  @Post('leads') @HttpCode(201) @RequireScope('leads:write')
  async createLead(@Req() req: AppRequest, @Body(new ZodPipe(createLeadSchema)) b: CreateLeadInput) { return { data: await this.leads.create(actorOf(req), b) }; }

  @Get('leads/:id') @RequireScope('leads:read') async getLead(@Req() req: AppRequest, @Param('id', uuid()) id: string) { return { data: await this.leads.get(actorOf(req), id) }; }

  @Patch('leads/:id') @RequireScope('leads:write')
  async updateLead(@Req() req: AppRequest, @Param('id', uuid()) id: string, @Body(new ZodPipe(updateLeadSchema)) b: UpdateLeadInput) { return { data: await this.leads.update(actorOf(req), id, b) }; }

  /** Soft delete (the lead leaves lists and can be restored by support). Permanent erasure is a privacy workflow in the app, not an API call. */
  @Delete('leads/:id') @HttpCode(204) @RequireScope('leads:delete')
  deleteLead(@Req() req: AppRequest, @Param('id', uuid()) id: string): Promise<void> { return this.leads.remove(actorOf(req), id); }

  @Post('leads/:id/stage') @HttpCode(200) @RequireScope('leads:write')
  async changeStage(@Req() req: AppRequest, @Param('id', uuid()) id: string, @Body(new ZodPipe(stageChangeSchema)) b: StageChangeInput) { return { data: await this.leads.changeStage(actorOf(req), id, b) }; }

  @Get('leads/:id/notes') @RequireScope('leads:read') async notes(@Req() req: AppRequest, @Param('id', uuid()) id: string) { return { data: await this.leads.notes(actorOf(req), id) }; }

  @Post('leads/:id/notes') @HttpCode(201) @RequireScope('leads:write')
  async addNote(@Req() req: AppRequest, @Param('id', uuid()) id: string, @Body(new ZodPipe(noteSchema)) b: { body: string }) { return { data: await this.leads.addNote(actorOf(req, { author: true }), id, b.body) }; }

  // ------------------------------------------------------------------ conversations (read only)
  @Get('conversations') @RequireScope('conversations:read')
  async listConversations(@Req() req: AppRequest, @Query(new ZodPipe(conversationListSchema)) q: z.infer<typeof conversationListSchema>) { return list(await this.conversations.list(actorOf(req), q) as never); }

  @Get('conversations/:id') @RequireScope('conversations:read') async getConversation(@Req() req: AppRequest, @Param('id', uuid()) id: string) { return { data: await this.conversations.get(actorOf(req), id) }; }

  @Get('conversations/:id/messages') @RequireScope('conversations:read')
  async messages(@Req() req: AppRequest, @Param('id', uuid()) id: string, @Query('before') before?: string) {
    const r = await this.conversations.messages(actorOf(req), id, before && /^[0-9a-f-]{36}$/i.test(before) ? before : undefined, 50);
    return { data: r.items, hasMore: r.hasMore };
  }

  // ------------------------------------------------------------------ appointments
  @Get('appointments') @RequireScope('appointments:read')
  async listAppointments(@Req() req: AppRequest, @Query(new ZodPipe(appointmentListQuerySchema)) q: z.infer<typeof appointmentListQuerySchema>) {
    const r = await this.appointments.list(actorOf(req), q);
    return { data: r.items };
  }

  @Get('appointments/:id') @RequireScope('appointments:read') async getAppointment(@Req() req: AppRequest, @Param('id', uuid()) id: string) { return { data: await this.appointments.get(actorOf(req), id) }; }

  @Post('appointments') @HttpCode(201) @RequireScope('appointments:write')
  async createAppointment(@Req() req: AppRequest, @Body(new ZodPipe(appointmentCreateSchema)) b: AppointmentCreateInput) { return { data: await this.appointments.create(actorOf(req), b, { source: 'api' }) }; }
}
