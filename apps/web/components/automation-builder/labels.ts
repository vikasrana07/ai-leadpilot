import type { AutomationAction } from '@leadpilot/validation';

export type ConditionField = 'lead.stage' | 'lead.temperature' | 'lead.score' | 'lead.source' | 'lead.assigned' | 'lead.budgetMax' | 'lead.location' | 'event.toStage' | 'event.toTemperature';
export type ConditionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

export const FIELD_LABELS: Record<ConditionField, string> = {
  'lead.stage': 'Stage', 'lead.temperature': 'Temperature', 'lead.score': 'Score', 'lead.source': 'Source', 'lead.assigned': 'Has an owner', 'lead.budgetMax': 'Maximum budget (₹)',
  'lead.location': 'Location', 'event.toStage': 'New stage (stage-change trigger)', 'event.toTemperature': 'New temperature (temperature trigger)',
};
export const OP_LABELS: Record<ConditionOp, string> = { eq: 'is', neq: 'is not', gt: 'is above', gte: 'is at least', lt: 'is below', lte: 'is at most', in: 'is any of' };
export const TEMPERATURES = ['HOT', 'WARM', 'COLD', 'UNKNOWN'] as const;

export type ValueKind = 'stage' | 'temperature' | 'source' | 'number' | 'boolean' | 'text';
export const valueKind = (f: ConditionField): ValueKind => (f === 'lead.stage' || f === 'event.toStage' ? 'stage' : f === 'lead.temperature' || f === 'event.toTemperature' ? 'temperature' : f === 'lead.source' ? 'source' : f === 'lead.score' || f === 'lead.budgetMax' ? 'number' : f === 'lead.assigned' ? 'boolean' : 'text');
export const opsFor = (f: ConditionField): ConditionOp[] => { const k = valueKind(f); return k === 'number' ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] : k === 'boolean' ? ['eq'] : k === 'text' ? ['eq', 'neq'] : ['eq', 'neq', 'in']; };

export type Choice = { value: string; label: string };
export const defaultValue = (f: ConditionField, op: ConditionOp, choices: Choice[]): string | number | boolean | string[] => {
  const k = valueKind(f);
  if (op === 'in') return [];
  if (k === 'number') return 0;
  if (k === 'boolean') return false;
  if (k === 'text') return '';
  return choices[0]?.value ?? '';
};

export const ACTION_TYPE_LABELS: Record<AutomationAction['type'], string> = {
  send_whatsapp_template: 'Send a WhatsApp template', send_message: 'Send a message (inside the 24-hour window)', assign_round_robin: 'Assign to the least busy agent', assign_to: 'Assign to a person',
  create_task: 'Create a task', notify: 'Send an in-app alert', change_stage: 'Move to a stage', add_tag: 'Add a tag',
};
export const ACTION_DEFAULTS: Record<AutomationAction['type'], AutomationAction> = {
  send_whatsapp_template: { type: 'send_whatsapp_template', template: '', language: 'en', params: [] },
  send_message: { type: 'send_message', text: 'Hi {{lead.firstName}}, thanks for your interest.' },
  assign_round_robin: { type: 'assign_round_robin' },
  assign_to: { type: 'assign_to', membershipId: '' },
  create_task: { type: 'create_task', title: 'Call {{lead.name}}', dueInHours: 24, assignee: 'lead_owner' },
  notify: { type: 'notify', target: 'lead_owner', title: 'Follow up with {{lead.name}}' },
  change_stage: { type: 'change_stage', stageKey: '' },
  add_tag: { type: 'add_tag', tag: '' },
};
export const PLACEHOLDERS = ['{{lead.name}}', '{{lead.firstName}}', '{{business.name}}', '{{appointment.date}}', '{{appointment.time}}', '{{appointment.location}}', '{{agent.name}}'] as const;

export const WAIT_UNITS = [{ value: 'minutes', label: 'minutes', factor: 1 }, { value: 'hours', label: 'hours', factor: 60 }, { value: 'days', label: 'days', factor: 1440 }] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number]['value'];
export function splitMinutes(minutes: number): { amount: number; unit: WaitUnit } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' };
  return { amount: minutes, unit: 'minutes' };
}
export const toMinutes = (amount: number, unit: WaitUnit): number => amount * (WAIT_UNITS.find((u) => u.value === unit)?.factor ?? 1);
