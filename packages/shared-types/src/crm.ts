export type Temperature = 'HOT' | 'WARM' | 'COLD' | 'UNKNOWN';
export type StageKind = 'OPEN' | 'WON' | 'LOST';
export type BuyingTimeline = 'UNKNOWN' | 'IMMEDIATE' | 'WITHIN_30_DAYS' | 'ONE_TO_THREE_MONTHS' | 'THREE_TO_SIX_MONTHS' | 'SIX_PLUS_MONTHS';

export interface LeadDto {
  id: string; name: string; phone: string | null; email: string | null;
  source: { id: string; key: string; name: string } | null;
  stage: { id: string; key: string; name: string; kind: StageKind; position: number };
  temperature: Temperature; budgetMin: number | null; budgetMax: number | null; location: string | null;
  propertyType: string | null; requirements: string | null; buyingTimeline: BuyingTimeline;
  assignedMembershipId: string | null; assignee: { id: string; name: string } | null;
  score: number | null; scoreOverridden: boolean; siteVisitRequested: boolean; lastContactedAt: string | null; nextFollowUpAt: string | null;
  customFields: Record<string, string | number | boolean>; tags: { id: string; name: string; color: string }[];
  lostReasonId: string | null; lostNote: string | null; createdAt: string; updatedAt: string;
}

export interface LeadDetailDto extends LeadDto { mergedLeads: { id: string; name: string }[]; canWrite: boolean }
export interface PagedResult<T> { items: T[]; total: number; page: number; pageSize: number }
