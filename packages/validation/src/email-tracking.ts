import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

export const EMAIL_DELIVERY_STATUSES = [
  'PENDING',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'COMPLAINED',
  'REJECTED',
  'SUPPRESSED',
  'FAILED',
] as const;
export type EmailDeliveryStatusType = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const EMAIL_EVENT_TYPES = [
  'SEND',
  'DELIVERY',
  'OPEN',
  'CLICK',
  'BOUNCE',
  'COMPLAINT',
  'REJECT',
] as const;
export type EmailEventTypeType = (typeof EMAIL_EVENT_TYPES)[number];

export const SUPPRESSION_REASONS = [
  'HARD_BOUNCE',
  'COMPLAINT',
  'UNSUBSCRIBED',
  'MANUAL',
] as const;
export type SuppressionReasonType = (typeof SUPPRESSION_REASONS)[number];

export const sendTrackedEmailSchema = z.object({
  to: email,
  leadId: z.string().uuid().optional(),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  text: z.string().trim().min(1, 'Message body is required').max(50_000),
  html: z.string().trim().max(100_000).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
export type SendTrackedEmailInput = z.infer<typeof sendTrackedEmailSchema>;

export const trackedEmailListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(EMAIL_DELIVERY_STATUSES).optional(),
  leadId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type TrackedEmailListQuery = z.infer<typeof trackedEmailListQuerySchema>;

export const emailSuppressionCreateSchema = z.object({
  email,
  reason: z.enum(SUPPRESSION_REASONS).default('MANUAL'),
  notes: z.string().trim().max(500).optional(),
});
export type EmailSuppressionCreateInput = z.infer<typeof emailSuppressionCreateSchema>;

export const emailSuppressionListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  reason: z.enum(SUPPRESSION_REASONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type EmailSuppressionListQuery = z.infer<typeof emailSuppressionListQuerySchema>;

export const snsMessageSchema = z.object({
  Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
  MessageId: z.string(),
  TopicArn: z.string(),
  Subject: z.string().optional(),
  Message: z.string(),
  Timestamp: z.string(),
  SignatureVersion: z.string(),
  Signature: z.string(),
  SigningCertURL: z.string().url(),
  SubscribeURL: z.string().url().optional(),
  Token: z.string().optional(),
});
export type SnsMessageInput = z.infer<typeof snsMessageSchema>;
