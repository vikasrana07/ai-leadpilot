import { z } from 'zod';

export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const RECIPIENT_STATUSES = [
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED_OPT_OUT',
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const campaignSegmentSchema = z.object({
  stageIds: z.array(z.string().uuid()).default([]),
  tagIds: z.array(z.string().uuid()).default([]),
  sourceIds: z.array(z.string().uuid()).default([]),
  temperatures: z.array(z.enum(['HOT', 'WARM', 'COLD', 'UNKNOWN'])).default([]),
  minScore: z.number().int().min(0).max(100).optional(),
  maxScore: z.number().int().min(0).max(100).optional(),
  siteVisitRequested: z.boolean().optional(),
});
export type CampaignSegment = z.infer<typeof campaignSegmentSchema>;

export const campaignTemplateParamSchema = z.object({
  index: z.number().int().min(1).max(20),
  field: z.enum(['name', 'phone', 'email', 'location', 'propertyType', 'custom']).default('name'),
  customValue: z.string().max(200).optional(),
  fallback: z.string().max(100).default('Customer'),
});
export type CampaignTemplateParam = z.infer<typeof campaignTemplateParamSchema>;

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2, 'Name must have at least 2 characters').max(120, 'Name must have at most 120 characters'),
  channelId: z.string().uuid('Select a valid WhatsApp channel'),
  templateId: z.string().uuid('Select a valid template'),
  templateParams: z.array(campaignTemplateParamSchema).default([]),
  segment: campaignSegmentSchema.default({
    stageIds: [],
    tagIds: [],
    sourceIds: [],
    temperatures: [],
  }),
  scheduledAt: z.string().datetime().optional().nullable(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  channelId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  templateParams: z.array(campaignTemplateParamSchema).optional(),
  segment: campaignSegmentSchema.optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const campaignQuerySchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CampaignQuery = z.infer<typeof campaignQuerySchema>;

export const recipientQuerySchema = z.object({
  status: z.enum(RECIPIENT_STATUSES).optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RecipientQuery = z.infer<typeof recipientQuerySchema>;

export const audiencePreviewSchema = z.object({
  segment: campaignSegmentSchema,
  channelId: z.string().uuid().optional(),
});
export type AudiencePreviewInput = z.infer<typeof audiencePreviewSchema>;

/** A manager attests that the leads gave permission to receive WhatsApp marketing (audit S-01). Never overrides a STOP. */
export const OPT_IN_BASES = ['existing_customer', 'signed_form_or_checkbox', 'verbal_recorded', 'other'] as const;
export const whatsappOptInSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  basis: z.enum(OPT_IN_BASES),
  attestation: z.literal(true, { error: 'You must confirm these leads agreed to receive WhatsApp marketing messages' }),
});
export type WhatsappOptInInput = z.infer<typeof whatsappOptInSchema>;
