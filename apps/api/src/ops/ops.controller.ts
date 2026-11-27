import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  appointmentCancelSchema, appointmentCreateSchema, appointmentListQuerySchema, appointmentRescheduleSchema, appointmentUpdateSchema, availabilityExceptionSchema, availabilityReplaceSchema,
  notificationListQuerySchema, notificationPreferencesSchema, slotsQuerySchema,
  type AppointmentCreateInput, type AppointmentListQuery, type SlotsQuery,
} from '@leadpilot/validation';
import { z } from 'zod';
import { actorFrom } from '../common/actor.js';
import { BillingExempt } from '../common/billing-meta.js';
import { CurrentTenant } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AppointmentsService } from './appointments.service.js';
import { NotificationsService } from './notifications.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller('appointments')
export class AppointmentsController {
  constructor(@Inject(AppointmentsService) private readonly svc: AppointmentsService) {}

  @Get() list(@CurrentTenant() c: TenantRequestContext, @Query(new ZodPipe(appointmentListQuerySchema)) q: AppointmentListQuery) { return this.svc.list(actorFrom(c), q); }
  @Get('slots') slots(@CurrentTenant() c: TenantRequestContext, @Query(new ZodPipe(slotsQuerySchema)) q: SlotsQuery) { return this.svc.slots(actorFrom(c), q); }

  @Get('availability')
  availability(@CurrentTenant() c: TenantRequestContext, @Query('membershipId') m?: string) {
    const id = m === 'default' ? null : (m ?? c.membershipId);
    return this.svc.getAvailability(actorFrom(c), id);
  }
  @Put('availability')
  replace(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(availabilityReplaceSchema)) b: z.infer<typeof availabilityReplaceSchema>) { return this.svc.replaceAvailability(actorFrom(c), b.membershipId, b.rules); }
  @Post('availability/exceptions') @HttpCode(201)
  addException(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(availabilityExceptionSchema)) b: z.infer<typeof availabilityExceptionSchema>) { return this.svc.addException(actorFrom(c), b); }
  @Delete('availability/exceptions/:id') @HttpCode(204)
  removeException(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.removeException(actorFrom(c), id); }

  @Post() @HttpCode(201) create(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(appointmentCreateSchema)) b: AppointmentCreateInput) { return this.svc.create(actorFrom(c), b, { source: 'manual' }); }
  @Get(':id') get(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.get(actorFrom(c), id); }
  @Patch(':id') update(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string, @Body(new ZodPipe(appointmentUpdateSchema)) b: z.infer<typeof appointmentUpdateSchema>) { return this.svc.update(actorFrom(c), id, b); }
  @Post(':id/confirm') @HttpCode(200) confirm(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.confirm(actorFrom(c), id); }
  @Post(':id/complete') @HttpCode(200) complete(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.complete(actorFrom(c), id); }
  @Post(':id/no-show') @HttpCode(200) noShow(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.noShow(actorFrom(c), id); }
  @Post(':id/cancel') @HttpCode(200) cancel(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string, @Body(new ZodPipe(appointmentCancelSchema)) b: { reason?: string }) { return this.svc.cancel(actorFrom(c), id, b.reason); }
  @Post(':id/reschedule') @HttpCode(200) reschedule(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string, @Body(new ZodPipe(appointmentRescheduleSchema)) b: z.infer<typeof appointmentRescheduleSchema>) { return this.svc.reschedule(actorFrom(c), id, b); }
}

import { WebPushService } from './web-push.service.js';

const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(10).max(512), auth: z.string().min(6).max(256) }),
  userAgent: z.string().max(300).optional(),
});
const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

@Controller('notifications') @BillingExempt()
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly svc: NotificationsService,
    @Inject(WebPushService) private readonly webPush: WebPushService,
  ) {}

  @Get('push/vapid-key') vapidKey() {
    const key = this.webPush.publicKey();
    return { enabled: key !== null, publicKey: key };
  }
  @Post('push/subscribe') @HttpCode(200)
  async subscribePush(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(pushSubscribeSchema)) b: z.infer<typeof pushSubscribeSchema>) {
    await this.webPush.subscribe(c.tenantId, c.userId, { endpoint: b.endpoint, keys: b.keys, ...(b.userAgent ? { userAgent: b.userAgent } : {}) });
    return { ok: true };
  }
  @Delete('push/subscribe') @HttpCode(204)
  async unsubscribePush(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(pushUnsubscribeSchema)) b: z.infer<typeof pushUnsubscribeSchema>) {
    await this.webPush.unsubscribe(c.tenantId, c.userId, b.endpoint);
  }

  @Get() list(@CurrentTenant() c: TenantRequestContext, @Query(new ZodPipe(notificationListQuerySchema)) q: z.infer<typeof notificationListQuerySchema>) { return this.svc.list(actorFrom(c), q); }
  @Get('unread-count') unread(@CurrentTenant() c: TenantRequestContext) { return this.svc.unreadCount(actorFrom(c)); }
  @Get('preferences') prefs(@CurrentTenant() c: TenantRequestContext) { return this.svc.preferences(actorFrom(c)); }
  @Put('preferences') setPrefs(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(notificationPreferencesSchema)) b: z.infer<typeof notificationPreferencesSchema>) { return this.svc.setPreferences(actorFrom(c), b.preferences); }
  @Post('read-all') @HttpCode(204) readAll(@CurrentTenant() c: TenantRequestContext) { return this.svc.markAllRead(actorFrom(c)); }
  @Post(':id/read') @HttpCode(204) read(@CurrentTenant() c: TenantRequestContext, @Param('id', uuid()) id: string) { return this.svc.markRead(actorFrom(c), id); }
}
