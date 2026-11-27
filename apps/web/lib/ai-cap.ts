import type { AiCapLevel } from '@/lib/ops';

interface CapView { level: AiCapLevel; capSource: 'own' | 'plan'; projectedExhaustionAt: string | null; resetsAt: string; inGrace: boolean }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** What to tell the user about their monthly AI allowance, and where to send them to fix it. Shared by the banner and the usage screens. */
export function aiCapMessage(u: CapView): { tone: 'warning' | 'danger'; text: string; actionLabel: string; actionHref: string } | null {
  if (u.level === 'OK') return null;
  const action = u.capSource === 'own' ? { actionLabel: 'Raise the AI limit', actionHref: '/ai-assistant' } : { actionLabel: 'Upgrade plan', actionHref: '/billing' };
  if (u.level === 'EXCEEDED') {
    return { tone: 'danger', ...action, text: `The monthly AI limit is reached. New chats go to your team${u.inGrace ? '; chats the AI is already handling can finish' : ''} until ${day(u.resetsAt)}.` };
  }
  const forecast = u.projectedExhaustionAt ? ` At this pace it runs out around ${day(u.projectedExhaustionAt)}.` : '';
  return { tone: 'warning', ...action, text: u.level === 'WARN_95' ? `Almost at the monthly AI limit.${forecast}` : `You have used over 80% of this month's AI allowance.${forecast}` };
}
