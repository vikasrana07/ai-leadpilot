export type DealPulseStatus = 'HEALTHY' | 'COOLING' | 'AT_RISK';

export interface DealPulseResult {
  status: DealPulseStatus;
  reasons: string[];
  hoursSinceLastInbound: number | null;
  patternInterrupt: string;
}

export interface PulseMessageInput {
  direction: string;
  body: string | null;
  createdAt: Date;
}

export interface PulseLeadInput {
  name: string;
  temperature: string;
  score: number | null;
  propertyType: string | null;
  location: string | null;
}

/**
 * Computes real-time conversation momentum (Deal Pulse) from message cadence and length decay,
 * returning actionable cooling reasons and a non-pushy pattern-interrupt message.
 */
export function computeDealPulse(
  messages: PulseMessageInput[],
  lead: PulseLeadInput,
  now = new Date(),
): DealPulseResult {
  const ordered = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const inbound = ordered.filter((m) => m.direction === 'INBOUND');
  const lastMsg = ordered.at(-1) ?? null;
  const lastInbound = inbound.at(-1) ?? null;

  const hoursSinceLastInbound = lastInbound
    ? Math.round(((now.getTime() - lastInbound.createdAt.getTime()) / 3_600_000) * 10) / 10
    : null;

  const reasons: string[] = [];
  let riskScore = 0;

  if (lastMsg && lastMsg.direction === 'OUTBOUND') {
    const hoursUnanswered = (now.getTime() - lastMsg.createdAt.getTime()) / 3_600_000;
    if (hoursUnanswered >= 24) {
      riskScore += 2;
      reasons.push(`Outbound message unanswered for ${Math.round(hoursUnanswered)}h`);
    } else if (hoursUnanswered >= 8) {
      riskScore += 1;
      reasons.push(`Awaiting customer reply (${Math.round(hoursUnanswered)}h)`);
    }
  }

  if (inbound.length >= 2) {
    const prevLen = (inbound.at(-2)?.body ?? '').trim().length;
    const lastLen = (inbound.at(-1)?.body ?? '').trim().length;
    if (prevLen >= 25 && lastLen > 0 && lastLen <= Math.floor(prevLen * 0.4)) {
      riskScore += 1;
      reasons.push('Customer replies are getting shorter');
    }
  }

  if ((lead.temperature === 'HOT' || (lead.score ?? 0) >= 70) && hoursSinceLastInbound !== null && hoursSinceLastInbound >= 18) {
    riskScore += 1;
    reasons.push('High-intent lead going quiet');
  }

  const status: DealPulseStatus = riskScore >= 2 ? 'AT_RISK' : riskScore === 1 ? 'COOLING' : 'HEALTHY';
  const firstName = lead.name.split(' ')[0] || 'there';
  const topic = lead.propertyType || lead.location || 'your inquiry';

  const patternInterrupt =
    status === 'HEALTHY'
      ? `Hi ${firstName}, let me know if you'd like to schedule a quick call or visit for ${topic}.`
      : `Hi ${firstName}, quick check-in — did your timeline for ${topic} shift, or is there a specific detail I can help clarify?`;

  return { status, reasons, hoursSinceLastInbound, patternInterrupt };
}
