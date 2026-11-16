import type { AutomationCondition } from '@leadpilot/validation';

export interface EvalContext {
  lead: { id: string; name: string; firstName: string; stage: string; temperature: string; score: number | null; source: string | null; assigned: boolean; assignedMembershipId: string | null; budgetMax: number | null; location: string | null; phone: string | null; phoneNorm: string | null };
  event: { type: string; id: string; depth: number; originAutomationId: string | null; toStage: string | null; toTemperature: string | null; payload: Record<string, unknown> };
  tenant: { name: string; timezone: string };
  appointment: { id: string; startsAt: Date; membershipId: string; location: string | null; agentName: string } | null;
}

function fieldValue(ctx: EvalContext, field: AutomationCondition['field']): string | number | boolean | null {
  switch (field) {
    case 'lead.stage': return ctx.lead.stage;
    case 'lead.temperature': return ctx.lead.temperature;
    case 'lead.score': return ctx.lead.score;
    case 'lead.source': return ctx.lead.source;
    case 'lead.assigned': return ctx.lead.assigned;
    case 'lead.budgetMax': return ctx.lead.budgetMax;
    case 'lead.location': return ctx.lead.location?.toLowerCase() ?? null;
    case 'event.toStage': return ctx.event.toStage;
    case 'event.toTemperature': return ctx.event.toTemperature;
  }
}

/** Unknown values never satisfy a numeric comparison (unknown is not zero), and `neq` on an unknown is true only when a value is expected to differ. */
export function evaluateCondition(c: AutomationCondition, ctx: EvalContext): boolean {
  const actual = fieldValue(ctx, c.field);
  const want = c.field === 'lead.location' && typeof c.value === 'string' ? c.value.toLowerCase() : c.value;
  switch (c.op) {
    case 'eq': return actual === want;
    case 'neq': return actual !== want;
    case 'in': return Array.isArray(want) && actual !== null && want.includes(String(actual));
    case 'gt': case 'gte': case 'lt': case 'lte': {
      if (typeof actual !== 'number' || typeof want !== 'number') return false;
      return c.op === 'gt' ? actual > want : c.op === 'gte' ? actual >= want : c.op === 'lt' ? actual < want : actual <= want;
    }
  }
}
export const evaluateConditions = (cs: AutomationCondition[], ctx: EvalContext): boolean => cs.every((c) => evaluateCondition(c, ctx));

const dateFmt = (tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = (tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });

/** Replaces {{placeholders}}. Unknown placeholders become an empty string rather than leaking template syntax to a customer. */
export function render(text: string, ctx: EvalContext): string {
  const vals: Record<string, string> = {
    'lead.name': ctx.lead.name, 'lead.firstName': ctx.lead.firstName, 'business.name': ctx.tenant.name,
    'appointment.date': ctx.appointment ? dateFmt(ctx.tenant.timezone).format(ctx.appointment.startsAt) : '',
    'appointment.time': ctx.appointment ? timeFmt(ctx.tenant.timezone).format(ctx.appointment.startsAt).toUpperCase() : '',
    'appointment.location': ctx.appointment?.location ?? '', 'agent.name': ctx.appointment?.agentName ?? '',
  };
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => vals[k] ?? '');
}

export const MAX_CHAIN_DEPTH = 3;
