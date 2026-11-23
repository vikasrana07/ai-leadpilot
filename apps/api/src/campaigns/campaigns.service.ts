import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@leadpilot/database';
import type {
  AudiencePreviewInput,
  CampaignQuery,
  CampaignSegment,
  CampaignTemplateParam,
  CreateCampaignInput,
  RecipientQuery,
  UpdateCampaignInput,
} from '@leadpilot/validation';
import { DbService } from '../db/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { ChannelsService } from '../channels/channels.module.js';
import { JobsService } from '../ops/jobs.service.js';
import { WHATSAPP_CLIENT, type WhatsAppClient } from '../whatsapp/whatsapp.client.js';
import { v7 as uuidv7 } from 'uuid';
import type { TenantRequestContext } from '../common/request-context.js';

export interface CampaignSummaryDto {
  id: string;
  name: string;
  status: string;
  channelId: string;
  channelName: string;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  optOutCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CampaignsService implements OnModuleInit {
  private readonly log = new Logger('CampaignsService');

  /** Callback registered by JobsService to schedule queue jobs */
  enqueueDispatch?: (tenantId: string, campaignId: string) => Promise<void>;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(WHATSAPP_CLIENT) private readonly wa: WhatsAppClient,
    @Optional() @Inject(JobsService) private readonly jobs?: JobsService,
  ) {}

  onModuleInit(): void {
    if (this.jobs) {
      this.jobs.processCampaignBatch = async (tenantId: string, campaignId: string) => {
        await this.dispatchBatch(tenantId, campaignId);
      };
      this.jobs.checkScheduledCampaigns = async () => {
        return this.checkScheduledCampaigns();
      };
      this.enqueueDispatch = async (tenantId: string, campaignId: string) => {
        await this.jobs!.enqueueCampaignDispatch(tenantId, campaignId);
      };
    }
  }

  /** Builds Prisma where-clause for lead filtering based on segment */
  private buildSegmentWhere(tenantId: string, segment: CampaignSegment): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = {
      tenantId,
      deletedAt: null,
      phoneNorm: { not: null },
    };

    if (segment.stageIds && segment.stageIds.length > 0) {
      where.stageId = { in: segment.stageIds };
    }
    if (segment.tagIds && segment.tagIds.length > 0) {
      where.tags = { some: { tagId: { in: segment.tagIds } } };
    }
    if (segment.sourceIds && segment.sourceIds.length > 0) {
      where.sourceId = { in: segment.sourceIds };
    }
    if (segment.temperatures && segment.temperatures.length > 0) {
      where.temperature = { in: segment.temperatures };
    }
    if (segment.minScore !== undefined || segment.maxScore !== undefined) {
      where.score = {};
      if (segment.minScore !== undefined) where.score.gte = segment.minScore;
      if (segment.maxScore !== undefined) where.score.lte = segment.maxScore;
    }
    if (segment.siteVisitRequested !== undefined) {
      where.siteVisitRequested = segment.siteVisitRequested;
    }

    return where;
  }

  /** Lists campaigns for a tenant with delivery metrics */
  async list(ctx: TenantRequestContext, query: CampaignQuery) {
    return this.db.tenantTx(ctx, async (tx) => {
      const where: Prisma.BroadcastCampaignWhereInput = {
        tenantId: ctx.tenantId,
        ...(query.status ? { status: query.status } : {}),
      };

      const campaigns = await tx.broadcastCampaign.findMany({
        where,
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          channel: { select: { id: true, name: true, externalId: true } },
          template: { select: { id: true, name: true, language: true, category: true } },
        },
      });

      const hasMore = campaigns.length > query.limit;
      const items = hasMore ? campaigns.slice(0, query.limit) : campaigns;
      const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;

      return {
        items: items.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          channelId: c.channelId,
          channelName: c.channel.name,
          templateId: c.templateId,
          templateName: c.templateName,
          templateLanguage: c.templateLanguage,
          segment: c.segment,
          templateParams: c.templateParams,
          totalRecipients: c.totalRecipients,
          sentCount: c.sentCount,
          deliveredCount: c.deliveredCount,
          readCount: c.readCount,
          failedCount: c.failedCount,
          optOutCount: c.optOutCount,
          scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
          startedAt: c.startedAt ? c.startedAt.toISOString() : null,
          completedAt: c.completedAt ? c.completedAt.toISOString() : null,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        nextCursor,
      };
    });
  }

  /** Gets campaign detail with full settings and statistics */
  async get(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const c = await tx.broadcastCampaign.findFirst({
        where: { id, tenantId: ctx.tenantId },
        include: {
          channel: { select: { id: true, name: true, externalId: true } },
          template: { select: { id: true, name: true, language: true, category: true, bodyPreview: true } },
        },
      });
      if (!c) throw new NotFoundException({ code: 'not_found', message: 'Campaign not found' });

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        channelId: c.channelId,
        channelName: c.channel.name,
        templateId: c.templateId,
        templateName: c.templateName,
        templateLanguage: c.templateLanguage,
        templateBodyPreview: c.template.bodyPreview,
        templateParams: c.templateParams as CampaignTemplateParam[],
        segment: c.segment as CampaignSegment,
        totalRecipients: c.totalRecipients,
        sentCount: c.sentCount,
        deliveredCount: c.deliveredCount,
        readCount: c.readCount,
        failedCount: c.failedCount,
        optOutCount: c.optOutCount,
        scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
        startedAt: c.startedAt ? c.startedAt.toISOString() : null,
        completedAt: c.completedAt ? c.completedAt.toISOString() : null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  }

  /** Previews matching audience size and identifies opt-out suppressed leads */
  async previewAudience(ctx: TenantRequestContext, input: AudiencePreviewInput) {
    return this.db.tenantTx(ctx, async (tx) => {
      const where = this.buildSegmentWhere(ctx.tenantId, input.segment);

      const matchingLeads = await tx.lead.findMany({
        where,
        select: { id: true, name: true, phone: true, phoneNorm: true, score: true, stage: { select: { name: true } } },
        take: 1000,
      });

      const leadIds = matchingLeads.map((l) => l.id);

      // Check opt-out consents
      const consents = await tx.consent.findMany({
        where: { tenantId: ctx.tenantId, channel: 'whatsapp', leadId: { in: leadIds } },
        orderBy: { createdAt: 'desc' },
      });

      const latestConsentByLead = new Map<string, string>();
      for (const cs of consents) {
        if (!latestConsentByLead.has(cs.leadId)) {
          latestConsentByLead.set(cs.leadId, cs.status);
        }
      }

      let optOutCount = 0;
      let eligibleCount = 0;

      for (const lead of matchingLeads) {
        if (latestConsentByLead.get(lead.id) === 'OPTED_OUT') {
          optOutCount++;
        } else {
          eligibleCount++;
        }
      }

      return {
        totalMatching: matchingLeads.length,
        eligibleCount,
        optOutCount,
        sampleLeads: matchingLeads.slice(0, 5).map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          score: l.score,
          stageName: l.stage.name,
          isOptedOut: latestConsentByLead.get(l.id) === 'OPTED_OUT',
        })),
      };
    });
  }

  /** Creates a new campaign */
  async create(ctx: TenantRequestContext, input: CreateCampaignInput) {
    return this.db.tenantTx(ctx, async (tx) => {
      // Validate channel
      const channel = await tx.channel.findFirst({
        where: { id: input.channelId, tenantId: ctx.tenantId, type: 'WHATSAPP' },
      });
      if (!channel) throw new BadRequestException({ code: 'invalid_channel', message: 'Selected channel is not an active WhatsApp channel' });

      // Validate template
      const template = await tx.whatsappTemplate.findFirst({
        where: { id: input.templateId, tenantId: ctx.tenantId },
      });
      if (!template) throw new BadRequestException({ code: 'invalid_template', message: 'Template not found' });

      // Determine initial status: SCHEDULED if future time given, else DRAFT
      let scheduledDate: Date | null = null;
      let initialStatus: 'DRAFT' | 'SCHEDULED' = 'DRAFT';

      if (input.scheduledAt) {
        scheduledDate = new Date(input.scheduledAt);
        if (scheduledDate.getTime() > Date.now()) {
          initialStatus = 'SCHEDULED';
        }
      }

      const campaignId = uuidv7();
      const campaign = await tx.broadcastCampaign.create({
        data: {
          id: campaignId,
          tenantId: ctx.tenantId,
          name: input.name,
          status: initialStatus,
          channelId: channel.id,
          templateId: template.id,
          templateName: template.name,
          templateLanguage: template.language,
          templateParams: (input.templateParams ?? []) as Prisma.InputJsonValue,
          segment: input.segment as Prisma.InputJsonValue,
          scheduledAt: scheduledDate,
          createdByUserId: ctx.userId ?? null,
        },
      });

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'campaign.created',
        resourceType: 'broadcast_campaign',
        resourceId: campaignId,
        metadata: { name: campaign.name, status: campaign.status, templateName: template.name },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      return { id: campaign.id, status: campaign.status };
    });
  }

  /** Updates draft or scheduled campaign */
  async update(ctx: TenantRequestContext, id: string, input: UpdateCampaignInput) {
    return this.db.tenantTx(ctx, async (tx) => {
      const existing = await tx.broadcastCampaign.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new NotFoundException({ code: 'not_found', message: 'Campaign not found' });

      if (existing.status !== 'DRAFT' && existing.status !== 'SCHEDULED') {
        throw new ConflictException({ code: 'cannot_update', message: `Cannot edit campaign in ${existing.status} status` });
      }

      let templateName = existing.templateName;
      let templateLanguage = existing.templateLanguage;

      if (input.templateId && input.templateId !== existing.templateId) {
        const template = await tx.whatsappTemplate.findFirst({
          where: { id: input.templateId, tenantId: ctx.tenantId },
        });
        if (!template) throw new BadRequestException({ code: 'invalid_template', message: 'Template not found' });
        templateName = template.name;
        templateLanguage = template.language;
      }

      let scheduledDate = existing.scheduledAt;
      let nextStatus = existing.status;

      if (input.scheduledAt !== undefined) {
        if (input.scheduledAt) {
          scheduledDate = new Date(input.scheduledAt);
          if (scheduledDate.getTime() > Date.now()) {
            nextStatus = 'SCHEDULED';
          }
        } else {
          scheduledDate = null;
          nextStatus = 'DRAFT';
        }
      }

      const updated = await tx.broadcastCampaign.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.channelId ? { channelId: input.channelId } : {}),
          ...(input.templateId ? { templateId: input.templateId, templateName, templateLanguage } : {}),
          ...(input.templateParams !== undefined ? { templateParams: input.templateParams as Prisma.InputJsonValue } : {}),
          ...(input.segment !== undefined ? { segment: input.segment as Prisma.InputJsonValue } : {}),
          scheduledAt: scheduledDate,
          status: nextStatus,
        },
      });

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'campaign.updated',
        resourceType: 'broadcast_campaign',
        resourceId: id,
        metadata: { name: updated.name, status: updated.status },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      return { id: updated.id, status: updated.status };
    });
  }

  /** Launches campaign immediately: locks audience, suppresses opt-outs, populates recipients, enqueues dispatch */
  async launch(ctx: { tenantId: string; userId?: string | null; requestId?: string; ip?: string }, id: string) {
    const shouldDispatch = await this.db.tenantTx({ tenantId: ctx.tenantId, userId: ctx.userId ?? undefined }, async (tx) => {
      const c = await tx.broadcastCampaign.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!c) throw new NotFoundException({ code: 'not_found', message: 'Campaign not found' });

      if (c.status !== 'DRAFT' && c.status !== 'SCHEDULED') {
        throw new ConflictException({ code: 'invalid_status', message: `Cannot launch campaign in ${c.status} status` });
      }

      // Resolve audience matching segment
      const segment = c.segment as CampaignSegment;
      const where = this.buildSegmentWhere(ctx.tenantId, segment);

      const matchingLeads = await tx.lead.findMany({
        where,
        select: { id: true, phoneNorm: true, phone: true },
      });

      const leadIds = matchingLeads.map((l) => l.id);

      // Fetch consent statuses for opt-out suppression
      const consents = await tx.consent.findMany({
        where: { tenantId: ctx.tenantId, channel: 'whatsapp', leadId: { in: leadIds } },
        orderBy: { createdAt: 'desc' },
      });

      const latestConsentByLead = new Map<string, string>();
      for (const cs of consents) {
        if (!latestConsentByLead.has(cs.leadId)) {
          latestConsentByLead.set(cs.leadId, cs.status);
        }
      }

      let eligibleCount = 0;
      let optOutCount = 0;

      const recipientRows: Array<{
        id: string;
        tenantId: string;
        campaignId: string;
        leadId: string;
        phone: string;
        status: 'PENDING' | 'SKIPPED_OPT_OUT';
      }> = [];

      for (const lead of matchingLeads) {
        const phone = lead.phoneNorm || lead.phone || '';
        if (!phone) continue;

        const isOptedOut = latestConsentByLead.get(lead.id) === 'OPTED_OUT';
        if (isOptedOut) {
          optOutCount++;
          recipientRows.push({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            campaignId: c.id,
            leadId: lead.id,
            phone,
            status: 'SKIPPED_OPT_OUT',
          });
        } else {
          eligibleCount++;
          recipientRows.push({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            campaignId: c.id,
            leadId: lead.id,
            phone,
            status: 'PENDING',
          });
        }
      }

      // Batch insert recipients
      if (recipientRows.length > 0) {
        await tx.broadcastRecipient.createMany({
          data: recipientRows,
          skipDuplicates: true,
        });
      }

      // Update campaign status to RUNNING
      await tx.broadcastCampaign.update({
        where: { id },
        data: {
          status: eligibleCount > 0 ? 'RUNNING' : 'COMPLETED',
          startedAt: new Date(),
          completedAt: eligibleCount === 0 ? new Date() : null,
          totalRecipients: recipientRows.length,
          optOutCount,
        },
      });

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId ?? null,
        action: 'campaign.launched',
        resourceType: 'broadcast_campaign',
        resourceId: id,
        metadata: {
          totalRecipients: recipientRows.length,
          eligibleCount,
          optOutCount,
        },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      return eligibleCount > 0;
    });

    if (shouldDispatch) {
      if (this.enqueueDispatch) {
        await this.enqueueDispatch(ctx.tenantId, id);
      } else {
        // Run inline asynchronously
        void this.dispatchBatch(ctx.tenantId, id).catch((e) =>
          this.log.error(`Inline dispatch error for campaign ${id}: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
    }

    return { id, status: shouldDispatch ? 'RUNNING' : 'COMPLETED' };
  }

  /** Cancels a scheduled or running campaign */
  async cancel(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const c = await tx.broadcastCampaign.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!c) throw new NotFoundException({ code: 'not_found', message: 'Campaign not found' });

      if (c.status === 'COMPLETED' || c.status === 'CANCELLED') {
        throw new ConflictException({ code: 'cannot_cancel', message: `Campaign is already ${c.status.toLowerCase()}` });
      }

      await tx.broadcastCampaign.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });

      // Mark remaining pending recipients as failed with cancellation note
      await tx.broadcastRecipient.updateMany({
        where: { campaignId: id, status: 'PENDING' },
        data: { status: 'FAILED', error: { message: 'Campaign was cancelled by user' } },
      });

      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'campaign.cancelled',
        resourceType: 'broadcast_campaign',
        resourceId: id,
        metadata: { previousStatus: c.status },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      return { id, status: 'CANCELLED' };
    });
  }

  /** Resolves template params for a specific lead */
  private resolveParams(lead: Record<string, unknown>, params: CampaignTemplateParam[]): string[] {
    const sorted = [...params].sort((a, b) => a.index - b.index);
    return sorted.map((p) => {
      if (p.field === 'custom' && p.customValue) return p.customValue;
      const val = lead[p.field];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val);
      }
      return p.fallback || '';
    });
  }

  /** Dispatches a batch of pending recipients with pacing and rate-limit guard */
  async dispatchBatch(tenantId: string, campaignId: string, batchSize = 50): Promise<{ processed: number; remaining: number }> {
    // 1. Fetch campaign and credentials
    const campaign = await this.db.tenantTx({ tenantId }, async (tx) => {
      return tx.broadcastCampaign.findFirst({
        where: { id: campaignId, tenantId },
        include: { channel: true },
      });
    });

    if (!campaign || campaign.status !== 'RUNNING') {
      return { processed: 0, remaining: 0 };
    }

    const { creds, channel } = await this.channels.credentialsFor(tenantId, campaign.channelId);

    // 2. Fetch batch of pending recipients
    const pendingRecipients = await this.db.tenantTx({ tenantId }, async (tx) => {
      return tx.broadcastRecipient.findMany({
        where: { campaignId, status: 'PENDING' },
        include: { lead: true },
        take: batchSize,
      });
    });

    if (pendingRecipients.length === 0) {
      // Mark campaign completed
      await this.db.tenantTx({ tenantId }, async (tx) => {
        await tx.broadcastCampaign.update({
          where: { id: campaignId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      });
      return { processed: 0, remaining: 0 };
    }

    const templateParams = (campaign.templateParams as CampaignTemplateParam[]) || [];
    let sentBatchCount = 0;
    let failedBatchCount = 0;

    for (const recipient of pendingRecipients) {
      const to = recipient.phone;
      const lead = recipient.lead;
      const params = this.resolveParams(lead, templateParams);

      try {
        // Send via WhatsApp Client
        const result = await this.wa.sendTemplate(
          channel.externalId ?? '',
          creds,
          to,
          campaign.templateName,
          campaign.templateLanguage,
          params,
        );

        // Update DB in tenant tx
        await this.db.tenantTx({ tenantId }, async (tx) => {
          // Find or create conversation
          let convo = await tx.conversation.findUnique({
            where: { channelId_externalThreadId: { channelId: channel.id, externalThreadId: to } },
          });

          if (!convo) {
            convo = await tx.conversation.create({
              data: {
                id: uuidv7(),
                tenantId,
                channelId: channel.id,
                leadId: lead.id,
                externalThreadId: to,
                assignedMembershipId: lead.assignedMembershipId,
                lastMessageAt: new Date(),
                lastMessagePreview: `Template: ${campaign.templateName}`,
                mode: 'HUMAN',
              },
            });
          }

          // Create message record
          const msgId = uuidv7();
          await tx.message.create({
            data: {
              id: msgId,
              tenantId,
              conversationId: convo.id,
              channelId: channel.id,
              direction: 'OUTBOUND',
              senderType: 'SYSTEM',
              type: 'TEMPLATE',
              body: `Template: ${campaign.templateName}`,
              template: {
                name: campaign.templateName,
                language: campaign.templateLanguage,
                params,
              },
              status: 'SENT',
              externalId: result.messageId || null,
            },
          });

          await tx.lead.update({
            where: { id: lead.id },
            data: { lastContactedAt: new Date() },
          });

          // Update recipient record
          await tx.broadcastRecipient.update({
            where: { id: recipient.id },
            data: {
              status: 'SENT',
              conversationId: convo.id,
              messageId: msgId,
              externalId: result.messageId || null,
              sentAt: new Date(),
            },
          });

          // Increment campaign sent count
          await tx.broadcastCampaign.update({
            where: { id: campaignId },
            data: { sentCount: { increment: 1 } },
          });
        });

        sentBatchCount++;
      } catch (err: unknown) {
        this.log.warn(`Delivery failure for recipient ${recipient.id}: ${err instanceof Error ? err.message : String(err)}`);

        await this.db.tenantTx({ tenantId }, async (tx) => {
          await tx.broadcastRecipient.update({
            where: { id: recipient.id },
            data: {
              status: 'FAILED',
              error: { message: err instanceof Error ? err.message : String(err) },
            },
          });

          await tx.broadcastCampaign.update({
            where: { id: campaignId },
            data: { failedCount: { increment: 1 } },
          });
        });

        failedBatchCount++;
      }

      // Small pacing delay (50ms) to prevent burst bans
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Check remaining
    const remaining = await this.db.tenantTx({ tenantId }, async (tx) => {
      const count = await tx.broadcastRecipient.count({
        where: { campaignId, status: 'PENDING' },
      });
      if (count === 0) {
        await tx.broadcastCampaign.update({
          where: { id: campaignId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
      return count;
    });

    if (remaining > 0) {
      if (this.enqueueDispatch) {
        await this.enqueueDispatch(tenantId, campaignId);
      } else {
        void this.dispatchBatch(tenantId, campaignId, batchSize).catch((e) =>
          this.log.error(`Remaining batch dispatch error: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
    }

    return { processed: sentBatchCount + failedBatchCount, remaining };
  }

  /** Lists recipients of a campaign with status filters and search */
  async listRecipients(ctx: TenantRequestContext, id: string, query: RecipientQuery) {
    return this.db.tenantTx(ctx, async (tx) => {
      const where: Prisma.BroadcastRecipientWhereInput = {
        tenantId: ctx.tenantId,
        campaignId: id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                { phone: { contains: query.q } },
                { lead: { name: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };

      const recipients = await tx.broadcastRecipient.findMany({
        where,
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          lead: { select: { id: true, name: true, phone: true } },
        },
      });

      const hasMore = recipients.length > query.limit;
      const items = hasMore ? recipients.slice(0, query.limit) : recipients;
      const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;

      return {
        items: items.map((r) => ({
          id: r.id,
          leadId: r.leadId,
          leadName: r.lead.name,
          phone: r.phone,
          status: r.status,
          conversationId: r.conversationId,
          messageId: r.messageId,
          externalId: r.externalId,
          sentAt: r.sentAt ? r.sentAt.toISOString() : null,
          deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
          readAt: r.readAt ? r.readAt.toISOString() : null,
          error: r.error,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor,
      };
    });
  }

  /** Checks and launches any scheduled campaigns whose scheduledAt has arrived */
  async checkScheduledCampaigns(): Promise<number> {
    // System sweep without tenant context: broadcast_campaigns is RLS-protected, so a plain query as the app role returns nothing.
    // list_due_campaigns() is a SECURITY DEFINER helper that returns ids only; each launch then runs in its own tenant transaction.
    const due = await this.db.prisma.$queryRaw<{ id: string; tenant_id: string }[]>`SELECT id, tenant_id FROM list_due_campaigns(20)`;

    for (const c of due) {
      try {
        await this.launch({ tenantId: c.tenant_id }, c.id);
      } catch (err) {
        this.log.error(`Failed to trigger scheduled campaign ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return due.length;
  }
}
