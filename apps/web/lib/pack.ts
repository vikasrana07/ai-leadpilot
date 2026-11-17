'use client';

import { packForIndustry, type IndustryPack } from '@leadpilot/shared-types';
import { useAuth } from '@/lib/auth';

/**
 * The industry pack of the active workspace (ADR-0009 / ADR-0011). Presentation config (lead form labels, appointment wording, modules) is
 * derived from the workspace's `industryPackId` at read time, never copied, so nothing here needs a migration when wording improves.
 */
export function usePack(): IndustryPack {
  const { activeWorkspace } = useAuth();
  return packForIndustry(activeWorkspace?.industryPackId ?? 'real_estate');
}

const pluralise = (noun: string) => (noun.endsWith('s') ? `${noun}es` : `${noun}s`);

/** The pack's word for an appointment in the forms we need: "Site visit" / "site visit" / "site visits" / "a site visit" / "Site visits". */
export function visitWords(pack: IndustryPack) {
  const Visit = pack.terminology.visit;
  const visit = Visit.toLowerCase();
  const visits = pluralise(visit);
  return { Visit, visit, visits, Visits: pluralise(Visit), a: `${/^[aeiou]/.test(visit) ? 'an' : 'a'} ${visit}` };
}
