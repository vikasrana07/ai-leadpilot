import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  emailSuppressionCreateSchema,
  emailSuppressionListQuerySchema,
  sendTrackedEmailSchema,
  trackedEmailListQuerySchema,
  type EmailSuppressionCreateInput,
  type EmailSuppressionListQuery,
  type SendTrackedEmailInput,
  type TrackedEmailListQuery,
} from '@leadpilot/validation';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { EmailTrackingService } from './email-tracking.service.js';

@Controller('emails')
export class EmailTrackingController {
  constructor(
    @Inject(EmailTrackingService) private readonly tracking: EmailTrackingService,
  ) {}

  @RequirePermissions('lead:read:own')
  @Get('stats')
  async stats(@CurrentTenant() ctx: TenantRequestContext) {
    return this.tracking.getStats(ctx.tenantId);
  }

  @RequirePermissions('lead:read:own')
  @Get()
  async list(
    @CurrentTenant() ctx: TenantRequestContext,
    @Query(new ZodPipe(trackedEmailListQuerySchema)) q: TrackedEmailListQuery,
  ) {
    return this.tracking.listTrackedEmails(ctx.tenantId, q);
  }

  @RequirePermissions('lead:read:own')
  @Get('suppressions')
  async listSuppressions(
    @CurrentTenant() ctx: TenantRequestContext,
    @Query(new ZodPipe(emailSuppressionListQuerySchema)) q: EmailSuppressionListQuery,
  ) {
    return this.tracking.listSuppressions(ctx.tenantId, q);
  }

  @RequirePermissions('lead:write:own')
  @Post('suppressions')
  @HttpCode(201)
  async addSuppression(
    @CurrentTenant() ctx: TenantRequestContext,
    @Body(new ZodPipe(emailSuppressionCreateSchema)) body: EmailSuppressionCreateInput,
  ) {
    return this.tracking.addSuppression(ctx.tenantId, body);
  }

  @RequirePermissions('lead:write:own')
  @Delete('suppressions/:id')
  @HttpCode(204)
  async removeSuppression(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.tracking.removeSuppression(ctx.tenantId, id);
  }

  @RequirePermissions('lead:read:own')
  @Get(':id')
  async getDetail(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tracking.getEmailDetail(ctx.tenantId, id);
  }

  @RequirePermissions('lead:write:own')
  @Post('send')
  @HttpCode(201)
  async send(
    @CurrentTenant() ctx: TenantRequestContext,
    @Body(new ZodPipe(sendTrackedEmailSchema)) body: SendTrackedEmailInput,
  ) {
    return this.tracking.sendTrackedEmail(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      body,
    );
  }
}
