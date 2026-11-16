import type { Prisma } from '@leadpilot/database';
import type { LeadDto } from '@leadpilot/shared-types';
import { fromMinor } from '../common/money.js';

export const LEAD_INCLUDE = {
  stage: { select: { id: true, key: true, name: true, kind: true, position: true } },
  source: { select: { id: true, key: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.LeadInclude;

export type LeadRow = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

export type { LeadDto };

export function toLeadDto(l: LeadRow, assignees: Map<string, string>): LeadDto {
  return {
    id: l.id, name: l.name, phone: l.phone, email: l.email, source: l.source, stage: l.stage,
    temperature: l.temperature, budgetMin: fromMinor(l.budgetMinMinor), budgetMax: fromMinor(l.budgetMaxMinor),
    location: l.location, propertyType: l.propertyType, requirements: l.requirements, buyingTimeline: l.buyingTimeline,
    assignedMembershipId: l.assignedMembershipId,
    assignee: l.assignedMembershipId ? { id: l.assignedMembershipId, name: assignees.get(l.assignedMembershipId) ?? 'Unknown' } : null,
    score: l.score, scoreOverridden: l.scoreOverridden, siteVisitRequested: l.siteVisitRequested, lastContactedAt: l.lastContactedAt?.toISOString() ?? null, nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
    customFields: l.customFields as LeadDto['customFields'], tags: l.tags.map((t) => t.tag),
    lostReasonId: l.lostReasonId, lostNote: l.lostNote, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString(),
  };
}
