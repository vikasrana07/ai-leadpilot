/**
 * Industry Packs (ADR-0009): versioned config that seeds a tenant's pipeline, lost reasons, sources and custom
 * fields. Core code never branches on industry; everything industry-specific lives here and is COPIED into
 * tenant-editable tables at onboarding, so tenant edits survive pack updates.
 */
export interface PackStage { key: string; name: string; kind: 'OPEN' | 'WON' | 'LOST'; qualifies?: boolean; canCloseWon?: boolean }
export interface PackCustomField { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'boolean'; options?: string[] }

export interface IndustryPack {
  id: string;
  version: number;
  label: string;
  stages: PackStage[];
  lostReasons: string[];
  sources: { key: string; name: string }[];
  customFields: PackCustomField[];
  terminology: { lead: string; visit: string };
  /** Optional modules shown in the app. Only what an industry actually uses appears in the menu. */
  modules: { properties: boolean };
}

const SOURCES = [
  { key: 'manual', name: 'Added manually' }, { key: 'csv_import', name: 'CSV import' }, { key: 'api', name: 'API / form' },
  { key: 'website_widget', name: 'Website chat' }, { key: 'whatsapp', name: 'WhatsApp' }, { key: 'meta_ads', name: 'Meta Ads' },
  { key: 'google_ads', name: 'Google Ads' }, { key: 'portal', name: 'Property portal' }, { key: 'referral', name: 'Referral' }, { key: 'walk_in', name: 'Walk-in' },
];

export const REAL_ESTATE_PACK: IndustryPack = {
  id: 'real_estate',
  version: 1,
  label: 'Real estate',
  stages: [
    { key: 'new', name: 'New', kind: 'OPEN' },
    { key: 'contacted', name: 'Contacted', kind: 'OPEN' },
    { key: 'qualified', name: 'Qualified', kind: 'OPEN', qualifies: true },
    { key: 'site_visit_scheduled', name: 'Site Visit Scheduled', kind: 'OPEN', qualifies: true },
    { key: 'site_visit_completed', name: 'Site Visit Completed', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'negotiation', name: 'Negotiation', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'won', name: 'Won', kind: 'WON' },
    { key: 'lost', name: 'Lost', kind: 'LOST' },
  ],
  lostReasons: ['Budget mismatch', 'Bought elsewhere', 'Not interested', 'Not reachable', 'Timeline too long', 'Duplicate or invalid'],
  sources: SOURCES,
  customFields: [
    { key: 'loan_required', label: 'Home loan needed', type: 'boolean' },
    { key: 'facing', label: 'Preferred facing', type: 'select', options: ['East', 'West', 'North', 'South', 'No preference'] },
    { key: 'possession', label: 'Possession preference', type: 'select', options: ['Ready to move', 'Under construction', 'Either'] },
  ],
  terminology: { lead: 'Lead', visit: 'Site visit' },
  modules: { properties: true },
};

export const GENERAL_PACK: IndustryPack = {
  id: 'general',
  version: 1,
  label: 'General',
  stages: [
    { key: 'new', name: 'New', kind: 'OPEN' },
    { key: 'contacted', name: 'Contacted', kind: 'OPEN' },
    { key: 'qualified', name: 'Qualified', kind: 'OPEN', qualifies: true },
    { key: 'proposal', name: 'Proposal', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'won', name: 'Won', kind: 'WON' },
    { key: 'lost', name: 'Lost', kind: 'LOST' },
  ],
  lostReasons: ['Budget mismatch', 'Chose a competitor', 'Not interested', 'Not reachable', 'Duplicate or invalid'],
  sources: SOURCES,
  customFields: [],
  terminology: { lead: 'Lead', visit: 'Meeting' },
  modules: { properties: false },
};

const PACKS: Record<string, IndustryPack> = { real_estate: REAL_ESTATE_PACK, general: GENERAL_PACK };

/** Industries without a dedicated pack yet fall back to the general pack. */
export function packForIndustry(industry: string): IndustryPack {
  return PACKS[industry] ?? GENERAL_PACK;
}

/**
 * True once the owner has actually picked an industry in onboarding. Until then the workspace carries the signup default, so
 * industry-specific modules (Properties...) stay hidden rather than assuming real estate. Workspaces with no onboarding record count as chosen.
 */
export function industryChosen(onboardingState: unknown): boolean {
  const s = onboardingState as { completed?: unknown; skipped?: unknown } | null | undefined;
  if (!s || typeof s !== 'object') return true;
  const completed = Array.isArray(s.completed) ? s.completed : [];
  const skipped = Array.isArray(s.skipped) ? s.skipped : [];
  return completed.includes('industry') && !skipped.includes('industry');
}
