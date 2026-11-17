import type { BuyingTimeline } from '@leadpilot/database';
import { packForIndustry } from '@leadpilot/shared-types';

export type CriterionKey = 'budget_known' | 'location_known' | 'timeline_30_days' | 'requirements_clear' | 'site_visit_requested';

export interface ScoringRules {
  criteria: { key: CriterionKey; label: string; points: number; enabled: boolean }[];
  hotMin: number;
  warmMin: number;
}

/** Defaults from the product brief (real estate): 15 / 15 / 30 / 15 / 25 = 100; Hot 70+, Warm 40-69, Cold 0-39. */
export const DEFAULT_SCORING_RULES: ScoringRules = {
  criteria: [
    { key: 'budget_known', label: 'Budget known', points: 15, enabled: true },
    { key: 'location_known', label: 'Preferred location known', points: 15, enabled: true },
    { key: 'timeline_30_days', label: 'Buying within 30 days', points: 30, enabled: true },
    { key: 'requirements_clear', label: 'Requirements clear', points: 15, enabled: true },
    { key: 'site_visit_requested', label: 'Site visit requested', points: 25, enabled: true },
  ],
  hotMin: 70,
  warmMin: 40,
};

/**
 * Defaults for a workspace's industry pack. Real estate (and anything with a budget field) gets the original rules unchanged. A pack without a
 * budget field turns the budget criterion off and moves its 15 points to location (+5) and requirements (+10), so a lead can still reach 100.
 */
export function defaultScoringRulesFor(packId: string): ScoringRules {
  const pack = packForIndustry(packId);
  const lf = pack.leadFields;
  const noBudget = lf.budget === null;
  return {
    hotMin: DEFAULT_SCORING_RULES.hotMin, warmMin: DEFAULT_SCORING_RULES.warmMin,
    criteria: DEFAULT_SCORING_RULES.criteria.map((c) => {
      switch (c.key) {
        case 'budget_known': return { ...c, enabled: !noBudget };
        case 'location_known': return { ...c, label: `${lf.location.label} known`, points: noBudget ? 20 : c.points };
        case 'timeline_30_days': return { ...c, label: lf.timeline?.soon ?? c.label };
        case 'requirements_clear': return { ...c, points: noBudget ? 25 : c.points };
        case 'site_visit_requested': return { ...c, label: `${pack.terminology.visit} requested` };
      }
    }),
  };
}

export interface ScorableLead {
  budgetMinMinor: bigint | null; budgetMaxMinor: bigint | null; location: string | null; propertyType: string | null;
  requirements: string | null; buyingTimeline: BuyingTimeline; siteVisitRequested: boolean;
}

export type CriterionState = 'met' | 'not_met' | 'unknown';
export interface ScoreBreakdownItem { key: CriterionKey; label: string; max: number; points: number; state: CriterionState; note: string }
export interface ScoreResult { score: number; temperature: 'HOT' | 'WARM' | 'COLD' | 'UNKNOWN'; breakdown: ScoreBreakdownItem[]; knownCount: number }

/**
 * Pure scoring. Principle from the brief: missing information is UNKNOWN, never negative intent.
 *  - A criterion is "unknown" when we simply have no data; it adds 0 points but is not held against the lead.
 *  - Only explicit information can be "not met" (e.g. the customer said they will buy in 6+ months).
 *  - A lead with no usable signal at all stays UNKNOWN rather than being labelled Cold.
 */
export function scoreLead(lead: ScorableLead, rules: ScoringRules = DEFAULT_SCORING_RULES): ScoreResult {
  const evaluate = (key: CriterionKey): { state: CriterionState; note: string } => {
    switch (key) {
      case 'budget_known': return lead.budgetMinMinor !== null || lead.budgetMaxMinor !== null ? { state: 'met', note: 'Budget provided' } : { state: 'unknown', note: 'Not asked or not shared yet' };
      case 'location_known': return lead.location?.trim() ? { state: 'met', note: lead.location.trim() } : { state: 'unknown', note: 'Not shared yet' };
      case 'timeline_30_days':
        if (lead.buyingTimeline === 'UNKNOWN') return { state: 'unknown', note: 'Timeline not shared yet' };
        return lead.buyingTimeline === 'IMMEDIATE' || lead.buyingTimeline === 'WITHIN_30_DAYS' ? { state: 'met', note: 'Within 30 days' } : { state: 'not_met', note: 'Later than 30 days' };
      case 'requirements_clear': return lead.propertyType?.trim() && (lead.requirements?.trim().length ?? 0) >= 10 ? { state: 'met', note: lead.propertyType.trim() } : { state: 'unknown', note: 'Interest or requirements still vague' };
      case 'site_visit_requested': return lead.siteVisitRequested ? { state: 'met', note: 'Asked for a visit or appointment' } : { state: 'unknown', note: 'Has not asked yet' };
    }
  };
  const breakdown: ScoreBreakdownItem[] = rules.criteria.filter((c) => c.enabled).map((c) => {
    const e = evaluate(c.key);
    return { key: c.key, label: c.label, max: c.points, points: e.state === 'met' ? c.points : 0, state: e.state, note: e.note };
  });
  const score = Math.min(100, breakdown.reduce((s, b) => s + b.points, 0));
  const knownCount = breakdown.filter((b) => b.state !== 'unknown').length;
  const temperature = score >= rules.hotMin ? 'HOT' : score >= rules.warmMin ? 'WARM' : knownCount === 0 ? 'UNKNOWN' : 'COLD';
  return { score, temperature, breakdown, knownCount };
}

export function temperatureFor(score: number, rules: ScoringRules): 'HOT' | 'WARM' | 'COLD' { return score >= rules.hotMin ? 'HOT' : score >= rules.warmMin ? 'WARM' : 'COLD'; }
