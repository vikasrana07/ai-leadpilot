import type { PackTerms } from '@leadpilot/shared-types';
import type { AutomationGraph, GraphIssue } from '@leadpilot/validation';

export interface Appointment {
  id: string; leadId: string; leadName: string; leadPhone: string | null; membershipId: string; agentName: string; title: string; startsAt: string; endsAt: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED'; notes: string | null; location: string | null; source: string; cancelledReason: string | null; rescheduledFromId: string | null;
  events?: { id: string; type: string; data: Record<string, unknown>; createdAt: string }[];
}
export interface Slot { startsAt: string; endsAt: string; membershipIds: string[] }
export interface SlotsResponse { timezone: string; days: { date: string; slots: Slot[] }[] }
export interface AvailabilityView { timezone: string; membershipId: string | null; usingDefault: boolean; rules: { dayOfWeek: number; startMinute: number; endMinute: number }[]; exceptions: { id: string; date: string; startMinute: number | null; endMinute: number | null; reason: string | null }[] }
export interface Notification { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string }
export interface TaskItem { id: string; title: string; notes: string | null; status: 'OPEN' | 'DONE'; dueAt: string | null; overdue: boolean; leadId: string | null; leadName: string | null; assigneeMembershipId: string | null; assigneeName: string | null; source: string; createdAt: string; completedAt: string | null }
export interface AutomationItem { id: string; templateKey: string | null; name: string; description: string | null; enabled: boolean; trigger: { type: string; hoursBefore?: number; days?: number }; conditions: { field: string; op: string; value: unknown }[]; actions: { type: string; [k: string]: unknown }[]; cooldownMinutes: number; missingWhatsappTemplates: string[]; last7Days: { succeeded: number; failed: number; skipped: number };
  /** Always present: legacy linear automations are lifted to a graph by the API. */
  graph: AutomationGraph; version: number; summary: string[]; graphAuthored: boolean; updatedAt: string }
export interface AutomationTemplate { key: string; name: string; description: string; category: string; trigger: AutomationItem['trigger']; actions: AutomationItem['actions']; requiresWhatsappTemplates: string[]; installed: boolean; graph: AutomationGraph; summary: string[] }
export type { GraphIssue };
export interface DryRunPathItem { nodeId: string; type: string; outcome: 'yes' | 'no' | 'would_run' | 'would_wait' | 'skipped'; detail?: string; conditions?: { text: string; pass: boolean }[]; wouldWaitMinutes?: number }
export interface DryRunResult { runId: string; conditionsMet: boolean; steps: { i: number; type: string; status: string; detail?: string }[]; path: DryRunPathItem[]; context: { lead: string; stage: string; temperature: string } }
export interface AutomationRun { id: string; automationId: string; automationName: string; eventType: string; leadId: string | null; leadName: string | null; status: 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'DRY_RUN'; attempts: number; error: string | null; steps: { i: number; type: string; status: string; detail?: string }[]; createdAt: string; finishedAt: string | null }
export interface UsageView {
  plan: { key: string; name: string; status: string; restricted: boolean; limits: Record<string, number | null>; features: Record<string, boolean>; meters: Record<string, number> };
  period: { from: string; to: string; timezone: string };
  ai: { runs: number; inputTokens: number; outputTokens: number; tokensUsed: number; cap: number; pct: number; warning: boolean; exceeded: boolean };
  messages: { inbound: number; aiReplies: number; agentReplies: number; automatedTemplates: number };
  leads: { created: number }; appointments: { created: number }; automations: { succeeded: number; failed: number; skipped: number };
  storage: { documents: number; bytes: number }; seats: { active: number };
}

type Words = Pick<PackTerms, 'lead' | 'Lead' | 'event'>;
const REAL_ESTATE_WORDS: Words = { lead: 'lead', Lead: 'Lead', event: 'visit' };
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const an = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;

/** In-app alert preference labels in the workspace's own words (real estate keeps "lead" and "visit"). */
export function notificationLabels(w: Words = REAL_ESTATE_WORDS): Record<string, string> {
  return {
    new_message: 'A customer writes in a chat',
    lead_assigned: `${cap(an(w.lead))} is assigned to me`, hot_lead: `${cap(an(w.lead))} turns hot`, handover: 'The AI hands a chat to a person', appointment_booked: `${cap(an(w.event))} is booked for me`,
    appointment_changed: `${cap(an(w.event))} is cancelled, moved or missed`, appointment_reminder: `An hour before ${an(w.event)}`, task_due: 'A task is due', sla_breach: 'A customer is waiting too long', automation_failed: 'An automation fails', lead_inactive: `${cap(an(w.lead))} goes quiet`, billing: 'Billing and subscription notices', quota: 'A plan limit is almost used up', integration: 'A webhook endpoint is switched off after repeated failures', security: 'LeadPilot support opens or closes a read-only support session', privacy: 'A data export is ready or a deletion is scheduled',
  };
}
export function triggerLabels(w: Words = REAL_ESTATE_WORDS): Record<string, string> {
  const lead = cap(an(w.lead)); const ev = cap(an(w.event));
  return {
    'lead.created': `${lead} is created`, 'lead.assigned': `${lead} is assigned`, 'lead.stage_changed': `${lead} changes stage`, 'lead.temperature_changed': `${lead}’s temperature changes`, 'lead.inactive': `${lead} goes quiet`,
    'message.inbound': 'A customer writes', 'conversation.handover': 'The AI hands over a chat', 'appointment.booked': `${ev} is booked`, 'appointment.confirmed': `${ev} is confirmed`, 'appointment.cancelled': `${ev} is cancelled`,
    'appointment.rescheduled': `${ev} is rescheduled`, 'appointment.completed': `${ev} is completed`, 'appointment.no_show': 'A customer does not show up', 'appointment.upcoming': `${ev} is coming up`, 'task.due': 'A task is due', 'sla.breached': 'A customer waits too long',
  };
}
export const NOTIFICATION_LABELS: Record<string, string> = notificationLabels();
export const TRIGGER_LABELS: Record<string, string> = triggerLabels();
export const ACTION_LABELS: Record<string, string> = { send_whatsapp_template: 'Send a WhatsApp template', send_message: 'Send a message', assign_round_robin: 'Assign to the least busy agent', assign_to: 'Assign to a person', create_task: 'Create a task', notify: 'Send an in-app alert', change_stage: 'Move to a stage', add_tag: 'Add a tag' };

export function describeTrigger(t: AutomationItem['trigger'], w: Words = REAL_ESTATE_WORDS): string {
  const base = triggerLabels(w)[t.type] ?? t.type;
  if (t.type === 'appointment.upcoming' && t.hoursBefore) return `${t.hoursBefore} hour${t.hoursBefore === 1 ? '' : 's'} before ${an(w.event)}`;
  if (t.type === 'lead.inactive' && t.days) return `${cap(an(w.lead))} has no contact for ${t.days} days`;
  return base;
}

export const fmtDay = (iso: string, tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
export const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).toUpperCase();
export const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const minuteLabel = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const parseMinute = (s: string) => { const [h, m] = s.split(':').map(Number) as [number, number]; return h * 60 + m; };
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
