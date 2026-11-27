import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { BillingExempt } from '../common/billing-meta.js';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { SlotRescueService } from './slot-rescue.service.js';

const settingsSchema = z.object({
  enabled: z.boolean(),
  maxCandidates: z.number().int().min(1).max(10).default(5),
  minTemperature: z.enum(['HOT', 'WARM']).default('WARM'),
});

const claimSchema = z.object({
  leadId: z.string().uuid(),
});

@Controller('appointments/slot-rescue')
export class SlotRescueAdminController {
  constructor(@Inject(SlotRescueService) private readonly svc: SlotRescueService) {}

  @Get()
  @RequirePermissions('appointment:read:all')
  list(@CurrentTenant() c: TenantRequestContext) {
    return this.svc.listOffers(c.tenantId);
  }

  @Get('settings')
  @RequirePermissions('appointment:read:all')
  getSettings(@CurrentTenant() c: TenantRequestContext) {
    return this.svc.getSettings(c.tenantId);
  }

  @Put('settings')
  @RequirePermissions('settings:manage')
  saveSettings(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.svc.saveSettings(c, body);
  }
}

@Controller('portal/claim')
@BillingExempt()
export class SlotRescuePublicController {
  constructor(@Inject(SlotRescueService) private readonly svc: SlotRescueService) {}

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.svc.getPublicOffer(token);
  }

  @Public()
  @Post(':token')
  @HttpCode(200)
  claim(
    @Param('token') token: string,
    @Query('l') queryLeadId: string | undefined,
    @Body(new ZodPipe(claimSchema)) body: z.infer<typeof claimSchema>,
  ) {
    return this.svc.claimOffer(token, body.leadId || queryLeadId || '');
  }
}
