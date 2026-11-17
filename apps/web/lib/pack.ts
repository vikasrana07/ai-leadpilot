'use client';

import { packForIndustry, packTerms, type IndustryPack, type PackTerms } from '@leadpilot/shared-types';
import { useAuth } from '@/lib/auth';

/**
 * The industry pack of the active workspace (ADR-0009 / ADR-0011). Presentation config (lead form labels, appointment wording, modules) is
 * derived from the workspace's `industryPackId` at read time, never copied, so nothing here needs a migration when wording improves.
 */
export function usePack(): IndustryPack {
  const { activeWorkspace } = useAuth();
  return packForIndustry(activeWorkspace?.industryPackId ?? 'real_estate');
}

/** The pack's word for an appointment in the forms we need: "Site visit" / "site visit" / "site visits" / "a site visit" / "Site visits". */
export function visitWords(pack: IndustryPack) {
  const t = packTerms(pack);
  return { Visit: t.Visit, visit: t.visit, visits: t.visits, Visits: t.Visits, a: t.aVisit };
}

/** Every noun form for the active workspace's industry: lead/leads/Lead/Leads, visit forms, short event word, summary words. */
export function useTerms(): PackTerms {
  return packTerms(usePack());
}
