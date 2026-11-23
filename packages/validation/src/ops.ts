import { z } from 'zod';

// ----------------------------------------------------------------------------- appointments
export const APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const;
/** Statuses that occupy the calendar (these are the ones the database exclusion constraints guard). */
export const ACTIVE_APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED'] as const;
export const APPOINTMENT_TRANSITIONS: Record<(typeof APPOINTMENT_STATUSES)[number], readonly (typeof APPOINTMENT_STATUSES)[number][]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW', 'COMPLETED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [], RESCHEDULED: [],
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const minuteOfDay = z.number().int().min(0).max(1440);

export const appointmentCreateSchema = z.object({
  leadId: z.string().uuid(),
  /** Omit to let the system choose the least-busy free agent. */
  membershipId: z.string().uuid().optional(),
  propertyId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(160).optional(),
  serviceType: z.string().trim().min(1).max(100).nullish(),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(480).default(60),
  location: z.string().trim().max(300).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Managers only: book outside working hours / on a blocked day. Never overrides overlap protection. */
  outsideHours: z.boolean().default(false),
});
export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

export const appointmentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  serviceType: z.string().trim().min(1).max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  location: z.string().trim().max(300).nullish(),
});
export const appointmentRescheduleSchema = z.object({
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  membershipId: z.string().uuid().optional(),
  reason: z.string().trim().max(300).optional(),
  outsideHours: z.boolean().default(false),
});
export const appointmentCancelSchema = z.object({ reason: z.string().trim().max(300).optional() });
export const appointmentListQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  membershipId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
export const slotsQuerySchema = z.object({
  from: isoDate,
  days: z.coerce.number().int().min(1).max(14).default(1),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  membershipId: z.string().uuid().optional(),
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export const availabilityRuleSchema = z.object({ dayOfWeek: z.number().int().min(0).max(6), startMinute: minuteOfDay, endMinute: minuteOfDay })
  .refine((r) => r.startMinute < r.endMinute, { message: 'Start must be before end', path: ['endMinute'] });
export const availabilityReplaceSchema = z.object({
  membershipId: z.string().uuid().nullable().default(null),
  rules: z.array(availabilityRuleSchema).max(60),
}).superRefine((v, ctx) => {
  const byDay = new Map<number, { s: number; e: number }[]>();
  for (const r of v.rules) byDay.set(r.dayOfWeek, [...(byDay.get(r.dayOfWeek) ?? []), { s: r.startMinute, e: r.endMinute }]);
  for (const list of byDay.values()) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) if ((list[i]?.s ?? 0) < (list[i - 1]?.e ?? 0)) ctx.addIssue({ code: 'custom', message: 'Working windows on the same day overlap', path: ['rules'] });
  }
});
export const availabilityExceptionSchema = z.object({
  membershipId: z.string().uuid().nullable().default(null),
  date: isoDate,
  startMinute: minuteOfDay.nullish(),
  endMinute: minuteOfDay.nullish(),
  reason: z.string().trim().max(200).nullish(),
}).refine((v) => (v.startMinute == null) === (v.endMinute == null) && (v.startMinute == null || (v.endMinute ?? 0) > v.startMinute), { message: 'Give both start and end (start before end), or neither for the whole day', path: ['startMinute'] });

// ----------------------------------------------------------------------------- automations
export const TRIGGER_TYPES = [
  'lead.created', 'lead.assigned', 'lead.stage_changed', 'lead.temperature_changed', 'lead.inactive',
  'message.inbound', 'conversation.handover',
  'appointment.booked', 'appointment.confirmed', 'appointment.cancelled', 'appointment.rescheduled', 'appointment.completed', 'appointment.no_show', 'appointment.upcoming',
  'task.due', 'sla.breached',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const CONDITION_FIELDS = ['lead.stage', 'lead.temperature', 'lead.score', 'lead.source', 'lead.assigned', 'lead.budgetMax', 'lead.location', 'event.toStage', 'event.toTemperature'] as const;
export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] as const;

export const triggerSchema = z.object({
  type: z.enum(TRIGGER_TYPES),
  /** appointment.upcoming: how long before the start */
  hoursBefore: z.number().min(0.25).max(168).optional(),
  /** lead.inactive: days without contact */
  days: z.number().int().min(1).max(90).optional(),
}).superRefine((t, ctx) => {
  if (t.type === 'appointment.upcoming' && t.hoursBefore === undefined) ctx.addIssue({ code: 'custom', message: 'Choose how long before the appointment', path: ['hoursBefore'] });
  if (t.type === 'lead.inactive' && t.days === undefined) ctx.addIssue({ code: 'custom', message: 'Choose how many days of inactivity', path: ['days'] });
});
export const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(100)).max(20)]),
});

const templateAction = z.object({ type: z.literal('send_whatsapp_template'), template: z.string().trim().min(1).max(80), language: z.string().trim().min(2).max(10).default('en'), params: z.array(z.string().max(200)).max(10).default([]) });
const textAction = z.object({ type: z.literal('send_message'), text: z.string().trim().min(1).max(1000) });
const assignRrAction = z.object({ type: z.literal('assign_round_robin') });
const assignAction = z.object({ type: z.literal('assign_to'), membershipId: z.string().uuid() });
const taskAction = z.object({ type: z.literal('create_task'), title: z.string().trim().min(1).max(200), dueInHours: z.number().min(0).max(24 * 60).default(24), assignee: z.union([z.literal('lead_owner'), z.string().uuid()]).default('lead_owner') });
const notifyAction = z.object({ type: z.literal('notify'), target: z.enum(['lead_owner', 'managers']).default('lead_owner'), title: z.string().trim().min(1).max(160), body: z.string().trim().max(500).optional() });
const stageAction = z.object({ type: z.literal('change_stage'), stageKey: z.string().trim().min(1).max(60) });
const tagAction = z.object({ type: z.literal('add_tag'), tag: z.string().trim().min(1).max(40) });
export const actionSchema = z.discriminatedUnion('type', [templateAction, textAction, assignRrAction, assignAction, taskAction, notifyAction, stageAction, tagAction]);
export type AutomationAction = z.infer<typeof actionSchema>;
export type AutomationTrigger = z.infer<typeof triggerSchema>;
export type AutomationCondition = z.infer<typeof conditionSchema>;

export const automationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullish(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(8).default([]),
  actions: z.array(actionSchema).min(1).max(6),
  cooldownMinutes: z.number().int().min(0).max(60 * 24 * 30).default(60),
  /** Optimistic concurrency: the version the editor loaded. A newer saved version makes the update fail with 409. */
  expectedVersion: z.number().int().min(1).optional(),
});
export type AutomationInput = z.infer<typeof automationInputSchema>;
export const automationEnableSchema = z.object({ enabled: z.boolean() });
export const automationFromTemplateSchema = z.object({ templateKey: z.string().trim().min(1).max(60) });
export const automationDryRunSchema = z.object({ leadId: z.string().uuid(), appointmentId: z.string().uuid().optional(), /** An unsaved draft to preview instead of the stored automation. */ graph: z.unknown().optional() });
export const automationRunsQuerySchema = z.object({ automationId: z.string().uuid().optional(), status: z.enum(['QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'DRY_RUN']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().uuid().optional() });

// ----------------------------------------------------------------------------- tasks / notifications / SLA
export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  leadId: z.string().uuid().nullish(),
  assigneeMembershipId: z.string().uuid().nullish(),
  dueAt: z.string().datetime().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  dueAt: z.string().datetime().nullish(),
  notes: z.string().trim().max(2000).nullish(),
  status: z.enum(['OPEN', 'DONE']).optional(),
  assigneeMembershipId: z.string().uuid().nullish(),
});
export const taskListQuerySchema = z.object({ status: z.enum(['OPEN', 'DONE']).optional(), leadId: z.string().uuid().optional(), mine: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const taskItemSchema = z.object({
  id: z.string(), title: z.string(), notes: z.string().nullable(), status: z.enum(['OPEN', 'DONE']), dueAt: z.string().nullable(), overdue: z.boolean(),
  leadId: z.string().nullable(), leadName: z.string().nullable(), assigneeMembershipId: z.string().nullable(), assigneeName: z.string().nullable(),
  source: z.string(), createdAt: z.string(), completedAt: z.string().nullable(),
});
export const taskListResponseSchema = z.object({ items: z.array(taskItemSchema) });

export const NOTIFICATION_TYPES = ['lead_assigned', 'hot_lead', 'handover', 'appointment_booked', 'appointment_changed', 'appointment_reminder', 'task_due', 'sla_breach', 'automation_failed', 'lead_inactive', 'billing', 'quota', 'privacy', 'integration', 'security', 'new_message'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationListQuerySchema = z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().datetime().optional() });
/** Sound and desktop alerts for new notifications: personal to the signed-in user (synced across their devices). */
export const alertSettingsSchema = z.object({ soundEnabled: z.boolean(), soundVolume: z.number().int().min(0).max(100), desktopEnabled: z.boolean() });
export type AlertSettings = z.infer<typeof alertSettingsSchema>;
export const DEFAULT_ALERT_SETTINGS: AlertSettings = { soundEnabled: true, soundVolume: 50, desktopEnabled: true };

export const notificationPreferencesSchema = z.object({ preferences: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), inApp: z.boolean() })).max(NOTIFICATION_TYPES.length) });

export const slaSettingsSchema = z.object({ enabled: z.boolean(), firstResponseMinutes: z.number().int().min(1).max(24 * 60) });
export type SlaSettings = z.infer<typeof slaSettingsSchema>;
export const DEFAULT_SLA: SlaSettings = { enabled: true, firstResponseMinutes: 15 };
