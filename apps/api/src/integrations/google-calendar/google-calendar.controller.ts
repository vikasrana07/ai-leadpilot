import { Body, Controller, Delete, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { GoogleCalendarService } from './google-calendar.service.js';

@ApiTags('Integrations')
@Controller('integrations/google-calendar')
export class GoogleCalendarController {
  constructor(
    @Inject(GoogleCalendarService) private readonly gcal: GoogleCalendarService,
  ) {}

  @Get()
  async status(@CurrentTenant() ctx: TenantRequestContext) {
    return this.gcal.getStatus(ctx.tenantId, ctx.membershipId);
  }

  @Get('auth-url')
  authUrl(@CurrentTenant() ctx: TenantRequestContext, @Query('redirectUri') redirectUri?: string) {
    const url = this.gcal.getAuthUrl(ctx.tenantId, ctx.membershipId, redirectUri);
    return { url };
  }

  @Post('connect')
  async connect(
    @CurrentTenant() ctx: TenantRequestContext,
    @Body() body: { code: string; redirectUri?: string },
  ) {
    const res = await this.gcal.connect(ctx.tenantId, ctx.membershipId, body.code, body.redirectUri);
    return { ok: true, email: res.email };
  }

  @Delete()
  async disconnect(@CurrentTenant() ctx: TenantRequestContext) {
    await this.gcal.disconnect(ctx.tenantId, ctx.membershipId);
    return { ok: true };
  }
}
