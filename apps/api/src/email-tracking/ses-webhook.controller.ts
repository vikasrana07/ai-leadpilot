import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { snsMessageSchema, type SnsMessageInput } from '@leadpilot/validation';
import { Public } from '../common/decorators.js';
import { EmailTrackingService } from './email-tracking.service.js';

@Controller('webhooks/ses')
export class SesWebhookController {
  private readonly log = new Logger('SesWebhook');

  constructor(
    @Inject(EmailTrackingService) private readonly tracking: EmailTrackingService,
  ) {}

  /**
   * Amazon SNS HTTPS webhook endpoint for Amazon SES event publishing.
   * Handles:
   * 1. Automatic SubscriptionConfirmation challenges with cryptographic verification.
   * 2. Ingestion of SES event notifications (Send, Delivery, Open, Click, Bounce, Complaint, Reject).
   */
  @Public()
  @SkipThrottle()
  @Post()
  @HttpCode(200)
  async receive(@Body() rawBody: unknown): Promise<{ status: string }> {
    let message: SnsMessageInput;
    try {
      // Some AWS SNS clients send body as JSON string if content-type was text/plain
      const parsedBody =
        typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      message = snsMessageSchema.parse(parsedBody);
    } catch (err) {
      this.log.error(`Malformed SNS message payload: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException({ code: 'malformed_sns_payload', message: 'Payload does not conform to AWS SNS message schema' });
    }

    return this.tracking.handleSnsMessage(message);
  }
}
