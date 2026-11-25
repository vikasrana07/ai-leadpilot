import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { InboundService } from './inbound.service.js';
import { PlatformWhatsappWebhookController, WhatsappWebhookController, WhatsappWebhookProcessor } from './whatsapp-webhook.controller.js';
import { VoiceTranscriptionService } from './voice-transcription.service.js';
import { CannedResponsesService } from './canned-responses.service.js';

@Module({
  imports: [ChannelsModule, LeadsModule],
  controllers: [ConversationsController, WhatsappWebhookController, PlatformWhatsappWebhookController],
  providers: [ConversationsService, InboundService, WhatsappWebhookProcessor, VoiceTranscriptionService, CannedResponsesService],
  exports: [InboundService, ConversationsService, VoiceTranscriptionService, CannedResponsesService],
})
export class ConversationsModule {}
