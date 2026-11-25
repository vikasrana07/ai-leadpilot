import { Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators.js';
import { GoogleCalendarService } from './google-calendar.service.js';

@ApiTags('Integrations')
@Controller('webhooks/google-calendar')
export class GoogleCalendarWebhookController {
  constructor(
    @Inject(GoogleCalendarService) private readonly gcal: GoogleCalendarService,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-goog-channel-id') channelId?: string,
    @Headers('x-goog-resource-state') resourceState?: string,
    @Headers('x-goog-channel-token') channelToken?: string,
  ) {
    return this.gcal.handleWebhookNotification({ channelId, resourceState, channelToken });
  }
}
