import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators.js';
import { DbService } from '../db/db.module.js';
import { parseExotelPayload, TelephonyService } from './telephony.service.js';

@Controller('webhooks/telephony')
export class TelephonyController {
  private readonly log = new Logger(TelephonyController.name);

  constructor(
    @Inject(TelephonyService) private readonly service: TelephonyService,
    @Inject(DbService) private readonly db: DbService,
  ) {}

  /**
   * Exotel Call End Webhook.
   * Exotel posts call metrics (CallSid, From, To, DialCallDuration, Status, RecordingUrl) upon call termination.
   */
  @Public()
  @SkipThrottle()
  @Post('exotel/:tenantId')
  @HttpCode(200)
  async handleExotelCall(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @Query('token') queryToken?: string,
  ) {
    const tenantExists = await this.db.userTx(null, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
    );
    if (!tenantExists) {
      throw new NotFoundException({ code: 'tenant_not_found', message: 'Workspace not found' });
    }

    const callRecord = parseExotelPayload(body);
    if (!callRecord) {
      throw new BadRequestException({ code: 'invalid_call_payload', message: 'Missing phone number in call payload' });
    }

    const result = await this.service.logCall(tenantId, callRecord);
    return {
      success: true,
      leadId: result.leadId,
      activityId: result.activityId,
    };
  }
}
