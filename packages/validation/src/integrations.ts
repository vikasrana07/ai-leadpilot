import { z } from 'zod';

// ----------------------------------------------------------------------------- outbound webhooks
/** Domain events a webhook endpoint may subscribe to. These are the transactional-outbox event types; payloads carry ids, not personal data. */
export const WEBHOOK_EVENTS = [
  'lead.created', 'lead.assigned', 'lead.stage_changed', 'lead.temperature_changed',
  'message.inbound', 'conversation.handover',
  'appointment.booked', 'appointment.rescheduled', 'appointment.confirmed', 'appointment.cancelled', 'appointment.completed', 'appointment.no_show',
  'task.due', 'sla.breached',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const webhookEndpointSchema = z.object({
  /** Scheme and network checks (https only, no private addresses) are enforced by the service, which resolves the host. */
  url: z.string().trim().url().max(500),
  description: z.string().trim().max(200).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Choose at least one event').max(WEBHOOK_EVENTS.length),
});
export type WebhookEndpointInput = z.infer<typeof webhookEndpointSchema>;
export const webhookEndpointUpdateSchema = webhookEndpointSchema.partial().extend({ enabled: z.boolean().optional() });

// ----------------------------------------------------------------------------- public API (v1)
export const v1ListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  stageId: z.string().uuid().optional(),
  temperature: z.enum(['HOT', 'WARM', 'COLD', 'UNKNOWN']).optional(),
  assigned: z.union([z.literal('unassigned'), z.string().uuid()]).optional(),
  sourceId: z.string().uuid().optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'name', 'score']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type V1ListQuery = z.infer<typeof v1ListQuerySchema>;

// ----------------------------------------------------------------------------- support access (read-only impersonation)
export const supportSessionStartSchema = z.object({
  reason: z.string().trim().min(10, 'Describe why access is needed (min 10 characters)').max(500),
  /** The admin must re-enter their password to start a session. */
  password: z.string().min(1).max(128),
  minutes: z.number().int().min(5).max(30).default(30),
});
export const supportAccessSettingSchema = z.object({ enabled: z.boolean() });

// ----------------------------------------------------------------------------- reports
export const REPORT_KEYS = ['acquisition', 'funnel', 'agents', 'response', 'appointments', 'ai', 'automations'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const reportQuerySchema = z.object({
  range: z.enum(['today', 'yesterday', '7d', '30d', 'month', 'custom']).default('30d'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

// ----------------------------------------------------------------------------- Google Calendar OAuth
/** `state` is the signed value returned by GET /integrations/google-calendar/auth-url; the server verifies it before exchanging `code`. */
export const googleCalendarConnectSchema = z.object({ code: z.string().trim().min(1).max(2048), state: z.string().trim().min(1).max(2048) });
export type GoogleCalendarConnectInput = z.infer<typeof googleCalendarConnectSchema>;
