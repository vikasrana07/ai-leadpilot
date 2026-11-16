import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { InboundService } from './inbound.service.js';
import { WhatsappWebhookController } from './whatsapp-webhook.controller.js';

@Module({ imports: [ChannelsModule, LeadsModule], controllers: [ConversationsController, WhatsappWebhookController], providers: [ConversationsService, InboundService], exports: [InboundService, ConversationsService] })
export class ConversationsModule {}
