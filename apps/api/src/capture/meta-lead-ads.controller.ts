import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { MetaLeadAdsService, parseMetaLeadPayload } from './meta-lead-ads.service.js';

@Controller('webhooks/meta-lead-ads')
export class MetaLeadAdsController {
  private readonly log = new Logger(MetaLeadAdsController.name);

  constructor(
    @Inject(MetaLeadAdsService) private readonly service: MetaLeadAdsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Meta Webhook Verification Handshake.
   * Meta sends GET request with hub.challenge, hub.mode, hub.verify_token.
   */
  @Public()
  @SkipThrottle()
  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Res() res: Response,
  ) {
    const expected = this.env.META_WEBHOOK_VERIFY_TOKEN ?? 'leadpilot_verify_token';
    if (mode === 'subscribe' && token === expected) {
      this.log.log('Meta Lead Ads webhook subscription verified');
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    throw new ForbiddenException({ code: 'verify_token_mismatch', message: 'Invalid verify token' });
  }

  /**
   * Inbound Lead Ads Event Webhook.
   * Receives notifications when an ad lead form is submitted on Facebook or Instagram.
   */
  @Public()
  @SkipThrottle()
  @Post()
  @HttpCode(200)
  async handleLead(
    @Query('tenantId') queryTenantId: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const data = parseMetaLeadPayload(body);
    const pageId = (body as { entry?: Array<{ id?: string }> })?.entry?.[0]?.id;

    const tenantId = await this.service.resolveTenantId(queryTenantId, pageId);
    const result = await this.service.ingestLead(tenantId, data);

    return {
      success: true,
      leadId: result.id,
      duplicate: result.duplicate,
    };
  }
}
