import { graphActions, graphTrigger, type AutomationAction, type AutomationCondition, type AutomationGraph, type AutomationTrigger, type GraphEdge, type GraphNode } from '@leadpilot/validation';

export interface AutomationTemplate {
  key: string; name: string; description: string; category: 'Leads' | 'Appointments' | 'Follow-up';
  trigger: AutomationTrigger; conditions: AutomationCondition[]; actions: AutomationAction[]; cooldownMinutes: number;
  /** WhatsApp templates the workspace must have registered (Integrations → Templates) for the message step to send. */
  requiresWhatsappTemplates: string[];
  /** Industry pack ids this template is offered to. Untagged templates are offered to every workspace. */
  industries?: string[];
  /**
   * Graph-authored templates (branches and waits). For these, `trigger` and `actions` are derived from the graph (the actions of every path,
   * for the template card and the WhatsApp-template check) and `conditions` is empty: the graph is the definition. Linear templates leave this unset.
   */
  graph?: AutomationGraph;
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

/**
 * Industry-flavoured starters (offered only to workspaces on the matching pack). Kept in their own array so the eight base templates above
 * stay exactly as they were. Same rules: everything is created DISABLED and WhatsApp message steps need the named template registered.
 */
export const INDUSTRY_TEMPLATES: AutomationTemplate[] = [
  {
    key: 'demo_class_reminder', name: 'Remind students the day before the demo class', category: 'Appointments', industries: ['coaching'],
    description: 'A WhatsApp reminder 24 hours before a booked demo class.',
    trigger: { type: 'appointment.upcoming', hoursBefore: 24 }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: ['demo_class_reminder'],
    actions: [{ type: 'send_whatsapp_template', template: 'demo_class_reminder', language: 'en', params: ['{{lead.firstName}}', '{{appointment.date}}', '{{appointment.time}}'] }],
  },
  {
    key: 'demo_class_followup', name: 'Follow up on enrolment after a demo class', category: 'Follow-up', industries: ['coaching'],
    description: 'When a demo class is marked completed, creates a task to ask about enrolment and fees.',
    trigger: { type: 'appointment.completed' }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: [],
    actions: [{ type: 'create_task', title: 'Ask {{lead.name}} about enrolment after the demo class', dueInHours: 24, assignee: 'lead_owner' }],
  },
  {
    key: 'consultation_reminder_24h', name: 'Remind patients the day before the consultation', category: 'Appointments', industries: ['healthcare'],
    description: 'A WhatsApp reminder 24 hours before a booked consultation. Contains the time and place only, never health details.',
    trigger: { type: 'appointment.upcoming', hoursBefore: 24 }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: ['consultation_reminder'],
    actions: [{ type: 'send_whatsapp_template', template: 'consultation_reminder', language: 'en', params: ['{{lead.firstName}}', '{{appointment.date}}', '{{appointment.time}}'] }],
  },
  {
    key: 'consultation_checkin', name: 'Check in after a consultation', category: 'Follow-up', industries: ['healthcare'],
    description: 'When a consultation is marked completed, creates a task for the team to check in and offer the next appointment.',
    trigger: { type: 'appointment.completed' }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: [],
    actions: [{ type: 'create_task', title: 'Check in with {{lead.name}} and offer the next appointment', dueInHours: 48, assignee: 'lead_owner' }],
  },
  {
    key: 'inspection_reminder_2h', name: 'Remind customers before the inspection', category: 'Appointments', industries: ['home_services'],
    description: 'A WhatsApp reminder two hours before the site inspection, so someone is there to let the team in.',
    trigger: { type: 'appointment.upcoming', hoursBefore: 2 }, conditions: [], cooldownMinutes: 0, requiresWhatsappTemplates: ['inspection_reminder'],
    actions: [{ type: 'send_whatsapp_template', template: 'inspection_reminder', language: 'en', params: ['{{lead.firstName}}', '{{appointment.date}}', '{{appointment.time}}'] }],
  },
  {
    key: 'quote_followup', name: 'Follow up two days after sending a quote', category: 'Follow-up', industries: ['home_services'],
    description: 'When a lead moves to "Quote sent", creates a task to follow up on the quote.',
    trigger: { type: 'lead.stage_changed' }, conditions: [{ field: 'event.toStage', op: 'eq', value: 'quote_sent' }], cooldownMinutes: 1440, requiresWhatsappTemplates: [],
    actions: [{ type: 'create_task', title: 'Follow up on the quote for {{lead.name}}', dueInHours: 48, assignee: 'lead_owner' }],
  },
];

// ----------------------------------------------------------------------------- graph templates (branching and waits)
const N = {
  trigger: (data: AutomationTrigger): GraphNode => ({ id: 't', type: 'trigger', data }),
  branch: (id: string, match: 'all' | 'any', conditions: AutomationCondition[]): GraphNode => ({ id, type: 'branch', data: { match, conditions } }),
  wait: (id: string, minutes: number): GraphNode => ({ id, type: 'wait', data: { minutes, exitOnOptOut: true } }),
  action: (id: string, data: AutomationAction): GraphNode => ({ id, type: 'action', data }),
  end: (id: string): GraphNode => ({ id, type: 'end', data: {} }),
};
const E = (from: string, to: string, label: GraphEdge['label'] = 'next'): GraphEdge => ({ id: `${from}-${to}-${label}`, from, to, label });
const tpl = (name: string, params: string[]): AutomationAction => ({ type: 'send_whatsapp_template', template: name, language: 'en', params });
const task = (title: string, dueInHours: number): AutomationAction => ({ type: 'create_task', title, dueInHours, assignee: 'lead_owner' });
const notify = (target: 'lead_owner' | 'managers', title: string, body?: string): AutomationAction => ({ type: 'notify', target, title, ...(body ? { body } : {}) });
const DAY = 1440;

function graphTemplate(d: { key: string; name: string; description: string; category: AutomationTemplate['category']; cooldownMinutes: number; industries?: string[]; nodes: GraphNode[]; edges: GraphEdge[] }): AutomationTemplate {
  const graph: AutomationGraph = { v: 1, nodes: d.nodes, edges: d.edges };
  const actions = graphActions(graph);
  return {
    key: d.key, name: d.name, description: d.description, category: d.category, cooldownMinutes: d.cooldownMinutes,
    ...(d.industries ? { industries: d.industries } : {}),
    trigger: graphTrigger(graph), conditions: [], actions, graph,
    requiresWhatsappTemplates: [...new Set(actions.flatMap((a) => (a.type === 'send_whatsapp_template' ? [a.template] : [])))],
  };
}

/**
 * Starters that use branching and waits (ADR 0010). Wait steps have two exits: "replied" (the customer wrote back) and "no reply" (the deadline
 * passed); a customer who opts out ends every waiting run. Same rules as the others: created DISABLED, message steps need the named WhatsApp template.
 */
export const GRAPH_TEMPLATES: AutomationTemplate[] = [
  graphTemplate({
    key: 'follow_up_no_reply', name: 'Follow up if a new lead does not reply in 24 hours', category: 'Follow-up', cooldownMinutes: DAY,
    description: 'Welcomes the lead on WhatsApp, waits a day, and if they have not replied creates a call task and alerts the owner. If they reply, the automation stops and your team takes over.',
    nodes: [N.trigger({ type: 'lead.created' }), N.action('a1', tpl('welcome_lead', ['{{lead.firstName}}', '{{business.name}}'])), N.wait('w1', DAY), N.end('done'),
      N.action('a2', task('Call {{lead.name}}: no reply to our WhatsApp', 2)), N.action('a3', notify('lead_owner', '{{lead.name}} has not replied in 24 hours', 'Try a phone call.'))],
    edges: [E('t', 'a1'), E('a1', 'w1'), E('w1', 'done', 'replied'), E('w1', 'a2', 'timeout'), E('a2', 'a3')],
  }),
  graphTemplate({
    key: 'hot_vs_warm_new_lead', name: 'Fast-track hot and referred leads, welcome the rest', category: 'Leads', cooldownMinutes: 0,
    description: 'A new lead that is already hot, or came by referral or walk-in, alerts the owner and gets a call task due within the hour. Everyone else gets the standard WhatsApp welcome.',
    nodes: [N.trigger({ type: 'lead.created' }),
      N.branch('b1', 'any', [{ field: 'lead.temperature', op: 'eq', value: 'HOT' }, { field: 'lead.source', op: 'in', value: ['referral', 'walk_in'] }]),
      N.action('a1', notify('lead_owner', 'Priority lead: {{lead.name}}', 'Call within the hour.')), N.action('a2', task('Call priority lead {{lead.name}}', 1)),
      N.action('a3', tpl('welcome_lead', ['{{lead.firstName}}', '{{business.name}}']))],
    edges: [E('t', 'b1'), E('b1', 'a1', 'yes'), E('a1', 'a2'), E('b1', 'a3', 'no')],
  }),
  graphTemplate({
    key: 'no_show_recovery_escalation', name: 'Win back no-shows, and escalate if they stay silent', category: 'Appointments', cooldownMinutes: 0,
    description: 'After a no-show, offers a new time on WhatsApp. If the customer replies, creates a re-booking task straight away. If they stay silent for a day, creates a call task and alerts managers.',
    nodes: [N.trigger({ type: 'appointment.no_show' }), N.action('a1', tpl('no_show_followup', ['{{lead.firstName}}'])), N.wait('w1', DAY),
      N.action('a2', task('{{lead.name}} replied: re-book the missed appointment', 2)),
      N.action('a3', task('Call {{lead.name}} to re-book: no reply to our message', 4)), N.action('a4', notify('managers', '{{lead.name}} missed an appointment and has not replied'))],
    edges: [E('t', 'a1'), E('a1', 'w1'), E('w1', 'a2', 'replied'), E('w1', 'a3', 'timeout'), E('a3', 'a4')],
  }),
  graphTemplate({
    key: 'unassigned_lead_escalation', name: 'Assign new leads, and escalate if no one owns them after 2 hours', category: 'Leads', cooldownMinutes: 0,
    description: 'Hands an unowned new lead to the least busy agent. Two hours later, if the lead still has no owner (for example no agent was available), managers are alerted and a task is created.',
    nodes: [N.trigger({ type: 'lead.created' }), N.branch('b1', 'all', [{ field: 'lead.assigned', op: 'eq', value: false }]), N.action('a1', { type: 'assign_round_robin' }), N.wait('w1', 120),
      N.branch('b2', 'all', [{ field: 'lead.assigned', op: 'eq', value: false }]), N.action('a2', notify('managers', '{{lead.name}} still has no owner after 2 hours')), N.action('a3', task('Assign an owner to {{lead.name}}', 1))],
    edges: [E('t', 'b1'), E('b1', 'a1', 'yes'), E('a1', 'w1'), E('w1', 'b2', 'timeout'), E('b2', 'a2', 'yes'), E('a2', 'a3')],
  }),
  graphTemplate({
    key: 'quiet_lead_reengage', name: 'Re-engage a lead that went quiet for a week', category: 'Follow-up', cooldownMinutes: 10 * DAY,
    description: 'After 7 days without contact, sends a friendly WhatsApp message. A reply alerts the owner; two days of silence tags the lead "no-response" and creates a last follow-up task.',
    nodes: [N.trigger({ type: 'lead.inactive', days: 7 }), N.action('a1', tpl('reengage_lead', ['{{lead.firstName}}', '{{business.name}}'])), N.wait('w1', 2 * DAY),
      N.action('a2', notify('lead_owner', '{{lead.name}} replied after a quiet week', 'Pick the conversation up.')), N.action('a3', { type: 'add_tag', tag: 'no-response' }), N.action('a4', task('Last follow-up with {{lead.name}}', 24))],
    edges: [E('t', 'a1'), E('a1', 'w1'), E('w1', 'a2', 'replied'), E('w1', 'a3', 'timeout'), E('a3', 'a4')],
  }),
  graphTemplate({
    key: 'demo_class_enrolment_nudge', name: 'Nudge students about enrolment the day after a demo class', category: 'Follow-up', cooldownMinutes: 0, industries: ['coaching'],
    description: 'A day after a demo class is completed, sends an enrolment message on WhatsApp. A reply creates a task to help them enrol; two days of silence creates a call task and alerts the owner.',
    nodes: [N.trigger({ type: 'appointment.completed' }), N.wait('w1', DAY), N.action('a1', tpl('enrolment_nudge', ['{{lead.firstName}}', '{{business.name}}'])), N.wait('w2', 2 * DAY),
      N.action('a2', task('{{lead.name}} replied about enrolment: help them enrol', 4)), N.action('a3', task('Call {{lead.name}} about enrolment', 24)), N.action('a4', notify('lead_owner', '{{lead.name}} has not answered about enrolment'))],
    edges: [E('t', 'w1'), E('w1', 'a1'), E('a1', 'w2'), E('w2', 'a2', 'replied'), E('w2', 'a3', 'timeout'), E('a3', 'a4')],
  }),
  graphTemplate({
    key: 'consultation_followup_checkin', name: 'Check in the day after a consultation', category: 'Follow-up', cooldownMinutes: 0, industries: ['healthcare'],
    description: 'A day after a consultation is completed, sends a friendly check-in and offers the next appointment. It never asks about health. A reply creates a task for your team; with no reply, it stops.',
    nodes: [N.trigger({ type: 'appointment.completed' }), N.wait('w1', DAY), N.action('a1', tpl('consultation_checkin', ['{{lead.firstName}}', '{{business.name}}'])), N.wait('w2', 2 * DAY),
      N.action('a2', task('{{lead.name}} replied: help with the next appointment', 4)), N.end('done')],
    edges: [E('t', 'w1'), E('w1', 'a1'), E('a1', 'w2'), E('w2', 'a2', 'replied'), E('w2', 'done', 'timeout')],
  }),
  graphTemplate({
    key: 'quote_followup_sequence', name: 'Follow up on a quote that has gone unanswered', category: 'Follow-up', cooldownMinutes: DAY, industries: ['home_services'],
    description: 'When a lead moves to "Quote sent", waits two days. If the lead is still at that stage, sends a WhatsApp follow-up; a reply alerts the owner, and two more days of silence create a call task.',
    nodes: [N.trigger({ type: 'lead.stage_changed' }), N.branch('b1', 'all', [{ field: 'event.toStage', op: 'eq', value: 'quote_sent' }]), N.wait('w1', 2 * DAY),
      N.branch('b2', 'all', [{ field: 'lead.stage', op: 'eq', value: 'quote_sent' }]), N.action('a1', tpl('quote_followup', ['{{lead.firstName}}', '{{business.name}}'])), N.wait('w2', 2 * DAY),
      N.action('a2', notify('lead_owner', '{{lead.name}} replied about the quote')), N.action('a3', task('Call {{lead.name}}: the quote has had no answer', 4))],
    edges: [E('t', 'b1'), E('b1', 'w1', 'yes'), E('w1', 'b2', 'timeout'), E('b2', 'a1', 'yes'), E('a1', 'w2'), E('w2', 'a2', 'replied'), E('w2', 'a3', 'timeout')],
  }),
];

export const ALL_AUTOMATION_TEMPLATES: AutomationTemplate[] = [...AUTOMATION_TEMPLATES, ...INDUSTRY_TEMPLATES, ...GRAPH_TEMPLATES];

/** The templates a workspace on `packId` is offered: untagged ones plus those tagged for its pack. */
export const templatesForPack = (packId: string): AutomationTemplate[] => ALL_AUTOMATION_TEMPLATES.filter((t) => !t.industries || t.industries.includes(packId));
