import { OutboxService } from '../ops/outbox.service.js';
import { Inject, Injectable } from '@nestjs/common';
import type { MessageStatus, Prisma, TxClient } from '@leadpilot/database';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '../common/actor.js';
import { normalizeEmail, normalizePhone } from '../common/phone.js';
import { DbService } from '../db/db.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { AiTrigger } from '../ai/ai-trigger.js';
import { RealtimeService } from '../realtime/realtime.module.js';

export interface InboundMessage {
  type: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';
  body: string | null;
  media?: { id: string; mime?: string; filename?: string; caption?: string; sha256?: string };
  /** Provider message id: the de-duplication key. */
  externalId: string;
  at: Date;
}

export interface IngestInput {
  tenantId: string;
  channel: { id: string; type: 'WHATSAPP' | 'WEB_WIDGET' | 'MESSENGER' | 'INSTAGRAM' };
  externalThreadId: string;
  contact: { name: string; phone?: string | null; email?: string | null };
  message: InboundMessage;
  source: 'whatsapp' | 'website_widget' | 'messenger' | 'instagram';
}

const OPT_OUT = /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*[.!]?\s*$/i;
const RANK: Record<MessageStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

function previewOf(m: { type: string; body: string | null }): string {
  if (m.type === 'TEXT') return (m.body ?? '').slice(0, 140);
  return `${m.body ? `${m.body.slice(0, 100)} ` : ''}[${m.type.toLowerCase()}]`.trim();
}

@Injectable()
export class InboundService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(LeadsService) private readonly leads: LeadsService, @Inject(RealtimeService) private readonly rt: RealtimeService, @Inject(AiTrigger) private readonly aiTrigger: AiTrigger, @Inject(OutboxService) private readonly outbox: OutboxService) {}

  /** Machine actor for creating leads from inbound traffic: may create leads in its own tenant, nothing else. */
  private systemActor(tenantId: string): Actor {
    return { tenantId, userId: null, membershipId: null, permissions: new Set(['lead:write:all', 'lead:assign']), requestId: undefined, ip: undefined };
  }

  /** Finds or creates the lead (matched by phone/email) and the conversation for a contact on a channel. */
  async resolveThread(tx: TxClient, tenantId: string, channel: { id: string; type: 'WHATSAPP' | 'WEB_WIDGET' | 'MESSENGER' | 'INSTAGRAM' }, externalThreadId: string, contact: { name: string; phone?: string | null; email?: string | null }, source: 'whatsapp' | 'website_widget' | 'messenger' | 'instagram', at: Date) {
    const phone = normalizePhone(contact.phone);
    const emailNorm = normalizeEmail(contact.email);
    const existingConvo = await tx.conversation.findUnique({ where: { channelId_externalThreadId: { channelId: channel.id, externalThreadId } } });
    let leadId = existingConvo?.leadId;
    if (!leadId) {
      const dupes = await this.leads.findDuplicates(tx, tenantId, phone?.norm ?? null, emailNorm);
      if (dupes[0]) leadId = dupes[0].id;
      else {
        const { lead } = await this.leads.createInTx(tx, this.systemActor(tenantId), { name: contact.name || 'New contact', phone: phone?.display ?? null, email: contact.email ?? null, location: null, propertyType: null, requirements: null, sourceKey: source }, { defaultSource: source });
        leadId = lead.id;
      }
    }
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { assignedMembershipId: true } });
    let conversationId = existingConvo?.id;
    let isNewConversation = false;
    if (!conversationId) {
      conversationId = uuidv7(); isNewConversation = true;
      const assistant = await tx.aiAssistant.findUnique({ where: { tenantId }, select: { enabled: true } });
      await tx.conversation.create({ data: { id: conversationId, tenantId, channelId: channel.id, leadId, externalThreadId, assignedMembershipId: lead.assignedMembershipId, lastMessageAt: at, mode: assistant?.enabled ? 'AI' : 'HUMAN' } });
      await tx.leadActivity.create({ data: { id: uuidv7(), tenantId, leadId, type: 'conversation_started', data: { channel: channel.type } } });
    }
    return { conversationId, leadId, isNewConversation, existingConvo, lead };
  }

  /**
   * Stores an inbound message idempotently: finds or creates the lead and conversation, records the message (a repeated
   * provider message id is ignored), updates the 24h window, consent and unread counters. Runs in ONE tenant transaction.
   */
  async ingest(input: IngestInput): Promise<{ duplicate: boolean; conversationId: string; leadId: string }> {
    const result = await this.db.tenantTx({ tenantId: input.tenantId }, async (tx) => {
      const { conversationId, leadId, isNewConversation, existingConvo, lead } = await this.resolveThread(tx, input.tenantId, input.channel, input.externalThreadId, input.contact, input.source, input.message.at);

      // De-duplication: INSERT ... ON CONFLICT DO NOTHING on (channel, provider message id); a redelivery changes nothing.
      const inserted = await tx.message.createMany({
        data: [{ id: uuidv7(), tenantId: input.tenantId, conversationId, channelId: input.channel.id, direction: 'INBOUND', senderType: 'CUSTOMER', type: input.message.type, body: input.message.body, media: input.message.media as Prisma.InputJsonValue | undefined, status: 'DELIVERED', externalId: input.message.externalId }], // createdAt = server receipt time: provider timestamps have 1-second precision and would mis-order replies sent within the same second
        skipDuplicates: true,
      });
      if (inserted.count === 0) return { duplicate: true as const, conversationId, leadId, assigned: existingConvo?.assignedMembershipId ?? null, messageId: null as string | null, preview: '' };

      const msg = await tx.message.findFirstOrThrow({ where: { channelId: input.channel.id, externalId: input.message.externalId }, select: { id: true } });
      const preview = previewOf(input.message);
      await tx.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date(Math.min(input.message.at.getTime(), Date.now())), lastMessageAt: new Date(), lastMessagePreview: preview, unreadCount: { increment: 1 }, status: 'OPEN', closedAt: null } });

      if (input.channel.type === 'WHATSAPP') {
        const optOut = input.message.type === 'TEXT' && OPT_OUT.test(input.message.body ?? '');
        const last = await tx.consent.findFirst({ where: { leadId, channel: 'whatsapp' }, orderBy: { createdAt: 'desc' } });
        if (optOut) await tx.consent.create({ data: { id: uuidv7(), tenantId: input.tenantId, leadId, channel: 'whatsapp', status: 'OPTED_OUT', source: 'inbound_stop_keyword' } });
        else if (!last || last.status === 'OPTED_OUT') await tx.consent.create({ data: { id: uuidv7(), tenantId: input.tenantId, leadId, channel: 'whatsapp', status: 'OPTED_IN', source: 'inbound_message' } });

        // Attribute response to recent broadcast campaign if the recipient hasn't already replied (72h window)
        const attributionCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
        const recentBroadcast = await tx.broadcastRecipient.findFirst({
          where: {
            tenantId: input.tenantId,
            leadId,
            status: { in: ['SENT', 'DELIVERED', 'READ'] },
            repliedAt: null,
            sentAt: { gte: attributionCutoff },
          },
          orderBy: { sentAt: 'desc' },
          select: { id: true, campaignId: true },
        });
        if (recentBroadcast) {
          await tx.broadcastRecipient.update({
            where: { id: recentBroadcast.id },
            data: { repliedAt: new Date() },
          });
          await tx.broadcastCampaign.update({
            where: { id: recentBroadcast.campaignId },
            data: { repliedCount: { increment: 1 } },
          });
        }
      }
      if (!isNewConversation && existingConvo?.status === 'CLOSED') await tx.leadActivity.create({ data: { id: uuidv7(), tenantId: input.tenantId, leadId, type: 'conversation_reopened', data: {} } });
      const assigned = existingConvo?.assignedMembershipId ?? lead.assignedMembershipId;
      await this.outbox.emit(tx, input.tenantId, 'message.inbound', { conversationId, messageId: msg.id, leadId });
      return { duplicate: false as const, conversationId, leadId, assigned, messageId: msg.id, preview };
    });

    if (!result.duplicate) {
      this.rt.publish(input.tenantId, { type: 'message.created', conversationId: result.conversationId, assignedMembershipId: result.assigned, data: { messageId: result.messageId, direction: 'INBOUND' } });
      if (result.messageId) this.aiTrigger.fire({ tenantId: input.tenantId, conversationId: result.conversationId, messageId: result.messageId });
    }
    return { duplicate: result.duplicate, conversationId: result.conversationId, leadId: result.leadId };
  }

  /** Delivery status update from the provider. Monotonic: sent < delivered < read; failed only before delivery. */
  async applyStatus(tenantId: string, channelId: string, externalId: string, status: 'sent' | 'delivered' | 'read' | 'failed', at: Date, error?: { code?: number; title?: string }): Promise<boolean> {
    const next: MessageStatus = status === 'sent' ? 'SENT' : status === 'delivered' ? 'DELIVERED' : status === 'read' ? 'READ' : 'FAILED';
    const out = await this.db.tenantTx({ tenantId }, async (tx) => {
      const m = await tx.message.findFirst({ where: { channelId, externalId, direction: 'OUTBOUND' }, select: { id: true, status: true, conversationId: true, conversation: { select: { assignedMembershipId: true } } } });
      if (!m) return null;
      const allowed = next === 'FAILED' ? RANK[m.status] < RANK.DELIVERED : RANK[next] > RANK[m.status] && m.status !== 'FAILED';
      if (!allowed) return null;
      await tx.message.update({ where: { id: m.id }, data: { status: next, statusUpdatedAt: at, ...(next === 'FAILED' ? { error: { message: error?.title ?? 'Delivery failed', code: error?.code ?? null, retryable: false } } : {}) } });

      // Update broadcast recipient status and campaign counters if externalId belongs to a broadcast
      const recipient = await tx.broadcastRecipient.findFirst({
        where: { tenantId, externalId },
        select: { id: true, campaignId: true, status: true },
      });
      if (recipient) {
        const recipNext = next === 'SENT' ? 'SENT' : next === 'DELIVERED' ? 'DELIVERED' : next === 'READ' ? 'READ' : 'FAILED';
        await tx.broadcastRecipient.update({
          where: { id: recipient.id },
          data: {
            status: recipNext,
            ...(next === 'DELIVERED' ? { deliveredAt: at } : {}),
            ...(next === 'READ' ? { readAt: at } : {}),
            ...(next === 'FAILED' ? { error: { message: error?.title ?? 'Delivery failed', code: error?.code ?? null } } : {}),
          },
        });

        if (next === 'DELIVERED' && recipient.status !== 'DELIVERED' && recipient.status !== 'READ') {
          await tx.broadcastCampaign.update({
            where: { id: recipient.campaignId },
            data: { deliveredCount: { increment: 1 } },
          });
        } else if (next === 'READ' && recipient.status !== 'READ') {
          await tx.broadcastCampaign.update({
            where: { id: recipient.campaignId },
            data: {
              readCount: { increment: 1 },
              ...(recipient.status !== 'DELIVERED' ? { deliveredCount: { increment: 1 } } : {}),
            },
          });
        } else if (next === 'FAILED' && recipient.status !== 'FAILED') {
          await tx.broadcastCampaign.update({
            where: { id: recipient.campaignId },
            data: { failedCount: { increment: 1 } },
          });
        }
      }

      return { id: m.id, conversationId: m.conversationId, assigned: m.conversation.assignedMembershipId };
    });
    if (out) this.rt.publish(tenantId, { type: 'message.status', conversationId: out.conversationId, assignedMembershipId: out.assigned, data: { messageId: out.id, status: next } });
    return out !== null;
  }
}

export type { TxClient };
