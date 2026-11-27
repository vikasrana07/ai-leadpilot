import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, Public, RequirePermissions } from '../../common/decorators.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { PortalEmailService } from './portal-email.service.js';

const configSchema = z.object({ enabled: z.boolean() });

@Controller('webhooks/portal-email')
export class PortalEmailWebhookController {
  constructor(@Inject(PortalEmailService) private readonly svc: PortalEmailService) {}

  @Public()
  @Post(':webhookKey')
  @HttpCode(200)
  ingest(@Param('webhookKey') webhookKey: string, @Body() body: Record<string, unknown>) {
    return this.svc.ingest(webhookKey, body ?? {});
  }
}

@Controller('integrations/portal-email')
export class PortalEmailAdminController {
  constructor(@Inject(PortalEmailService) private readonly svc: PortalEmailService) {}

  @Get()
  @RequirePermissions('integration:manage')
  getConfig(@CurrentTenant() ctx: TenantRequestContext) {
    return this.svc.getConfig(ctx);
  }

  @Put()
  @RequirePermissions('integration:manage')
  saveConfig(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(configSchema)) body: { enabled: boolean }) {
    return this.svc.saveConfig(ctx, body.enabled);
  }

  @Post('rotate-key')
  @HttpCode(200)
  @RequirePermissions('integration:manage')
  rotateKey(@CurrentTenant() ctx: TenantRequestContext) {
    return this.svc.rotateKey(ctx);
  }

  @Get('logs')
  @RequirePermissions('integration:manage')
  logs(@CurrentTenant() ctx: TenantRequestContext) {
    return this.svc.logs(ctx);
  }
}
