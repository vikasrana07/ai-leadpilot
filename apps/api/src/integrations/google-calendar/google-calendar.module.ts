import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller.js';
import { GoogleCalendarWebhookController } from './google-calendar-webhook.controller.js';
import { GoogleCalendarService } from './google-calendar.service.js';

@Module({
  controllers: [GoogleCalendarController, GoogleCalendarWebhookController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
