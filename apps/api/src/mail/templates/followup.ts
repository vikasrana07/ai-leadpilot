import { textToHtmlParagraphs } from './layout.js';

export type FollowupTemplateCategory = 'Onboarding' | 'Follow-up' | 'Appointments' | 'Sales';

export interface FollowupTemplateDefinition {
  key: string;
  name: string;
  category: FollowupTemplateCategory;
  description: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
}

export interface FollowupTemplateContext {
  lead?: { name?: string | null; firstName?: string | null };
  business?: { name?: string | null };
  agent?: { name?: string | null };
  appointment?: { date?: string | null; time?: string | null; location?: string | null };
}

export const FOLLOWUP_TEMPLATES: FollowupTemplateDefinition[] = [
  {
    key: 'followup_welcome',
    name: 'New Lead Welcome',
    category: 'Onboarding',
    description: 'Warm introduction after a new inquiry arrives.',
    subjectTemplate: 'Thanks for reaching out to {{business.name}}, {{lead.firstName}}',
    bodyTemplate:
      'Hi {{lead.firstName}},\n\nThank you for your interest in {{business.name}}. I am {{agent.name}}, and I will be happy to help you with your inquiry.\n\nCould you share a convenient time for a quick 10-minute call so we can understand your requirements better?\n\nBest regards,\n{{agent.name}}\n{{business.name}}',
    variables: ['lead.firstName', 'business.name', 'agent.name'],
  },
  {
    key: 'followup_post_call',
    name: 'Post-Call / Meeting Recap',
    category: 'Follow-up',
    description: 'Follow up after a discovery call or meeting with next steps.',
    subjectTemplate: 'Great speaking with you, {{lead.firstName}} — next steps',
    bodyTemplate:
      'Hi {{lead.firstName}},\n\nThank you for taking the time to speak with me today. As discussed, here is a quick summary of our conversation and the next steps.\n\nPlease reply to this email if you have any questions or would like to adjust anything.\n\nBest regards,\n{{agent.name}}\n{{business.name}}',
    variables: ['lead.firstName', 'business.name', 'agent.name'],
  },
  {
    key: 'followup_appointment_confirm',
    name: 'Appointment Confirmation',
    category: 'Appointments',
    description: 'Confirm date, time, and location for a scheduled visit or call.',
    subjectTemplate: 'Confirmed: Your appointment with {{business.name}}',
    bodyTemplate:
      'Hi {{lead.firstName}},\n\nYour appointment with {{business.name}} is confirmed for {{appointment.date}} at {{appointment.time}} ({{appointment.location}}).\n\nIf you need to reschedule, simply reply to this email and we will find another time that works.\n\nLooking forward to meeting you,\n{{agent.name}}',
    variables: ['lead.firstName', 'business.name', 'agent.name', 'appointment.date', 'appointment.time', 'appointment.location'],
  },
  {
    key: 'followup_no_show',
    name: 'Missed Appointment Re-engagement',
    category: 'Appointments',
    description: 'Polite check-in after a missed visit or call to reschedule.',
    subjectTemplate: 'Sorry we missed you, {{lead.firstName}} — want to reschedule?',
    bodyTemplate:
      'Hi {{lead.firstName}},\n\nWe missed connecting with you at our scheduled time. No worries at all—schedules get busy.\n\nWould you like to pick another slot this week? Just reply with a time that works best for you.\n\nBest regards,\n{{agent.name}}\n{{business.name}}',
    variables: ['lead.firstName', 'business.name', 'agent.name'],
  },
  {
    key: 'followup_proposal',
    name: 'Brochure / Proposal Follow-up',
    category: 'Sales',
    description: 'Share requested pricing, brochure, or proposal details.',
    subjectTemplate: 'Details & proposal from {{business.name}}',
    bodyTemplate:
      'Hi {{lead.firstName}},\n\nAs promised, here are the details and options we discussed for your requirements.\n\nTake a look and let me know which option aligns best with your timeline and budget—I am happy to walk you through any questions.\n\nBest regards,\n{{agent.name}}\n{{business.name}}',
    variables: ['lead.firstName', 'business.name', 'agent.name'],
  },
  {
    key: 'followup_quiet_checkin',
    name: 'Quiet Lead Check-in',
    category: 'Follow-up',
    description: 'Gentle check-in for leads that have gone quiet for a few days.',
    subjectTemplate: 'Quick check-in from {{business.name}}',
    bodyTemplate:
      'Hi {{lead.firstName}},\n\nI wanted to check in and see if you are still exploring options or if anything has changed on your end.\n\nFeel free to reply anytime—happy to help whenever you are ready.\n\nBest regards,\n{{agent.name}}\n{{business.name}}',
    variables: ['lead.firstName', 'business.name', 'agent.name'],
  },
];

function firstNameOf(fullName?: string | null): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] || 'there';
}

export function renderTemplateString(template: string, ctx: FollowupTemplateContext): string {
  const leadName = ctx.lead?.name?.trim() || 'there';
  const map: Record<string, string> = {
    'lead.name': leadName,
    'lead.firstName': ctx.lead?.firstName?.trim() || firstNameOf(ctx.lead?.name),
    'business.name': ctx.business?.name?.trim() || 'our team',
    'agent.name': ctx.agent?.name?.trim() || 'Your Advisor',
    'appointment.date': ctx.appointment?.date?.trim() || '[Date]',
    'appointment.time': ctx.appointment?.time?.trim() || '[Time]',
    'appointment.location': ctx.appointment?.location?.trim() || 'Online / Office',
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => map[key] ?? match);
}

export function getFollowupTemplate(key: string): FollowupTemplateDefinition | undefined {
  return FOLLOWUP_TEMPLATES.find((t) => t.key === key);
}

export function renderFollowupTemplate(
  key: string,
  ctx: FollowupTemplateContext,
): { subject: string; text: string; html: string } | null {
  const tpl = getFollowupTemplate(key);
  if (!tpl) return null;
  const subject = renderTemplateString(tpl.subjectTemplate, ctx);
  const text = renderTemplateString(tpl.bodyTemplate, ctx);
  const html = textToHtmlParagraphs(text);
  return { subject, text, html };
}
