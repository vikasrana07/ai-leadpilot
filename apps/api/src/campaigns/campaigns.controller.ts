import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  audiencePreviewSchema,
  campaignQuerySchema,
  createCampaignSchema,
  createFollowUpSchema,
  recipientQuerySchema,
  updateCampaignSchema,
  retryFailedSchema,
  whatsappOptInSchema,
  type AudiencePreviewInput,
  type CampaignQuery,
  type CreateCampaignInput,
  type CreateFollowUpInput,
  type RecipientQuery,
  type RetryFailedInput,
  type UpdateCampaignInput,
  type WhatsappOptInInput,
} from '@leadpilot/validation';
import { CampaignsService } from './campaigns.service.js';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  @RequirePermissions('campaign:read')
  list(
    @CurrentTenant() ctx: TenantRequestContext,
    @Query(new ZodPipe(campaignQuerySchema)) query: CampaignQuery,
  ) {
    return this.svc.list(ctx, query);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('campaign:read')
  preview(
    @CurrentTenant() ctx: TenantRequestContext,
    @Body(new ZodPipe(audiencePreviewSchema)) input: AudiencePreviewInput,
  ) {
    return this.svc.previewAudience(ctx, input);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('campaign:manage')
  create(
    @CurrentTenant() ctx: TenantRequestContext,
    @Body(new ZodPipe(createCampaignSchema)) input: CreateCampaignInput,
  ) {
    return this.svc.create(ctx, input);
  }

  /** Records a manager's attestation that these leads opted in to WhatsApp marketing. Declared before `:id` routes. */
  @Post('consent/opt-in')
  @HttpCode(200)
  @RequirePermissions('campaign:manage', 'lead:write:all')
  recordOptIn(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(whatsappOptInSchema)) input: WhatsappOptInInput) {
    return this.svc.recordWhatsappOptIn(ctx, input);
  }

  @Get(':id')
  @RequirePermissions('campaign:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('campaign:manage')
  update(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id') id: string,
    @Body(new ZodPipe(updateCampaignSchema)) input: UpdateCampaignInput,
  ) {
    return this.svc.update(ctx, id, input);
  }

  @Post(':id/launch')
  @HttpCode(200)
  @RequirePermissions('campaign:manage')
  launch(@CurrentTenant() ctx: TenantRequestContext, @Param('id') id: string) {
    return this.svc.launch(ctx, id);
  }

  @Post(':id/retry-failed')
  @HttpCode(200)
  @RequirePermissions('campaign:manage')
  retryFailed(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id') id: string,
    @Body(new ZodPipe(retryFailedSchema)) input: RetryFailedInput,
  ) {
    return this.svc.retryFailed(ctx, id, input);
  }

  @Post(':id/follow-up')
  @HttpCode(201)
  @RequirePermissions('campaign:manage')
  createFollowUp(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id') id: string,
    @Body(new ZodPipe(createFollowUpSchema)) input: CreateFollowUpInput,
  ) {
    return this.svc.createFollowUp(ctx, id, input);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('campaign:manage')
  cancel(@CurrentTenant() ctx: TenantRequestContext, @Param('id') id: string) {
    return this.svc.cancel(ctx, id);
  }

  @Get(':id/recipients')
  @RequirePermissions('campaign:read')
  listRecipients(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id') id: string,
    @Query(new ZodPipe(recipientQuerySchema)) query: RecipientQuery,
  ) {
    return this.svc.listRecipients(ctx, id, query);
  }
}

