import type { AutomationAction, AutomationCondition, AutomationTrigger } from '@leadpilot/validation';

export interface AutomationTemplate {
  key: string; name: string; description: string; category: 'Leads' | 'Appointments' | 'Follow-up';
  trigger: AutomationTrigger; conditions: AutomationCondition[]; actions: AutomationAction[]; cooldownMinutes: number;
  /** WhatsApp templates the workspace must have registered (Integrations → Templates) for the message step to send. */
  requiresWhatsappTemplates: string[];
}

/**
 * The eight starter automations. Placeholders: {{lead.name}} {{lead.firstName}} {{business.name}} {{appointment.date}} {{appointment.time}} {{appointment.location}} {{agent.name}}.
 * Everything is created DISABLED: enabling is a deliberate act, and message steps depend on templates only the tenant can register with Meta.
 */
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: 'welcome_new_lead', name: 'Welcome new leads on WhatsApp', category: 'Leads',
    description: 'Greets every new lead that has a phone number with an approved WhatsApp template.',
    trigger: { type: 'lead.created' }, conditions: [], cooldownMinutes: 1440, requiresWhatsappTemplates: ['welcome_lead'],
    actions: [{ type: 'send_whatsapp_template', template: 'welcome_lead', language: 'en', params: ['{{lead.firstName}}', '{{business.name}}'] }],
  },
  {
    key: 'assign_unassigned_lead', name: 'Assign new leads to the least busy agent', category: 'Leads',
    description: 'When a lead arrives with no owner, hand it to the agent with the fewest open leads.',
    trigger: { type: 'lead.created' }, conditions: [{ field: 'lead.assigned', op: 'eq', value: false }], cooldownMinutes: 0, requiresWhatsappTemplates: [],
    actions: [{ type: 'assign_round_robin' }],
  },
  {
    key: 'hot_lead_alert', name: 'Alert the owner when a lead turns hot', category: 'Leads',
    description: 'Notifies the lead owner (or managers if unassigned) and creates a call-back task due within the hour.',
    trigger: { type: 'lead.temperature_changed' }, conditions: [{ field: 'event.toTemperature', op: 'eq', value: 'HOT' }], cooldownMinutes: 720, requiresWhatsappTemplates: [],
    actions: [
      { type: 'notify', target: 'lead_owner', title: '{{lead.name}} is now a hot lead', body: 'Call within the hour while interest is high.' },
      { type: 'create_task', title: 'Call hot lead {{lead.name}}', dueInHours: 1, assignee: 'lead_owner' },
    ],
  },
  {
    key: 'appointment_confirmation', name: 'Confirm bookings on WhatsApp', category: 'Appointments',
    description: 'Sends the customer a confirmation message as soon as a visit is booked.',
    trigger: { type: 'appointment.booked' }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: ['appointment_confirmation'],
    actions: [{ type: 'send_whatsapp_template', template: 'appointment_confirmation', language: 'en', params: ['{{lead.firstName}}', '{{appointment.date}}', '{{appointment.time}}'] }],
  },
  {
    key: 'appointment_reminder_24h', name: 'Remind customers a day before', category: 'Appointments',
    description: 'A WhatsApp reminder 24 hours before the visit, and a heads-up to the agent.',
    trigger: { type: 'appointment.upcoming', hoursBefore: 24 }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: ['appointment_reminder'],
    actions: [
      { type: 'send_whatsapp_template', template: 'appointment_reminder', language: 'en', params: ['{{lead.firstName}}', '{{appointment.date}}', '{{appointment.time}}'] },
    ],
  },
  {
    key: 'appointment_reminder_2h', name: 'Remind customers two hours before', category: 'Appointments',
    description: 'A last reminder two hours before the visit.',
    trigger: { type: 'appointment.upcoming', hoursBefore: 2 }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: ['appointment_reminder'],
    actions: [{ type: 'send_whatsapp_template', template: 'appointment_reminder', language: 'en', params: ['{{lead.firstName}}', '{{appointment.date}}', '{{appointment.time}}'] }],
  },
  {
    key: 'no_show_followup', name: 'Follow up after a no-show', category: 'Appointments',
    description: 'Creates a follow-up task for the agent and offers the customer a new time.',
    trigger: { type: 'appointment.no_show' }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: ['no_show_followup'],
    actions: [
      { type: 'create_task', title: 'Re-book {{lead.name}} after missed visit', dueInHours: 4, assignee: 'lead_owner' },
      { type: 'send_whatsapp_template', template: 'no_show_followup', language: 'en', params: ['{{lead.firstName}}'] },
    ],
  },
  {
    key: 'inactive_lead_nudge', name: 'Nudge owners about quiet leads', category: 'Follow-up',
    description: 'After 3 days without contact on an open lead, notify the owner and create a task.',
    trigger: { type: 'lead.inactive', days: 3 }, conditions: [], cooldownMinutes: 4320, requiresWhatsappTemplates: [],
    actions: [
      { type: 'notify', target: 'lead_owner', title: 'No contact with {{lead.name}} for 3 days', body: 'Reach out before the lead goes cold.' },
      { type: 'create_task', title: 'Follow up with {{lead.name}}', dueInHours: 24, assignee: 'lead_owner' },
    ],
  },
];
