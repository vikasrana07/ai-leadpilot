import type { BuyingTimeline, Prisma, Temperature } from '@leadpilot/database';
import { fromMinor } from '../common/money.js';

export const LEAD_INCLUDE = {
  stage: { select: { id: true, key: true, name: true, kind: true, position: true } },
  source: { select: { id: true, key: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.LeadInclude;

export type LeadRow = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

export interface LeadDto {
  id: string; name: string; phone: string | null; email: string | null;
  source: { id: string; key: string; name: string } | null;
  stage: { id: string; key: string; name: string; kind: string; position: number };
  temperature: Temperature; budgetMin: number | null; budgetMax: number | null; location: string | null;
  propertyType: string | null; requirements: string | null; buyingTimeline: BuyingTimeline;
  assignedMembershipId: string | null; assignee: { id: string; name: string } | null;
  score: number | null; lastContactedAt: string | null; nextFollowUpAt: string | null;
  customFields: Prisma.JsonValue; tags: { id: string; name: string; color: string }[];
  lostReasonId: string | null; lostNote: string | null;
  createdAt: string; updatedAt: string;
}

export function toLeadDto(l: LeadRow, assignees: Map<string, string>): LeadDto {
  return {
    id: l.id, name: l.name, phone: l.phone, email: l.email, source: l.source, stage: l.stage,
    temperature: l.temperature, budgetMin: fromMinor(l.budgetMinMinor), budgetMax: fromMinor(l.budgetMaxMinor),
    location: l.location, propertyType: l.propertyType, requirements: l.requirements, buyingTimeline: l.buyingTimeline,
    assignedMembershipId: l.assignedMembershipId,
    assignee: l.assignedMembershipId ? { id: l.assignedMembershipId, name: assignees.get(l.assignedMembershipId) ?? 'Unknown' } : null,
    score: l.score, lastContactedAt: l.lastContactedAt?.toISOString() ?? null, nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
    customFields: l.customFields, tags: l.tags.map((t) => t.tag),
    lostReasonId: l.lostReasonId, lostNote: l.lostNote, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString(),
  };
}
