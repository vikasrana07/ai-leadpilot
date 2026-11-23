import { Module } from '@nestjs/common';
import { EmailTrackingService } from './email-tracking.service.js';
import { EmailTrackingController } from './email-tracking.controller.js';
import { SesWebhookController } from './ses-webhook.controller.js';
import { TrackingPixelController } from './tracking-pixel.controller.js';

@Module({
  controllers: [
    EmailTrackingController,
    SesWebhookController,
    TrackingPixelController,
  ],
  providers: [EmailTrackingService],
  exports: [EmailTrackingService],
})
export class EmailTrackingModule {}
