export type CriterionState = 'met' | 'not_met' | 'unknown';
export interface ScoreItem { key: string; label: string; max: number; points: number; state: CriterionState; note: string }
export interface ScoreView {
  score: number | null; temperature: string; overridden: boolean; scoredAt: string | null; ruleVersion: number; automaticScore: number;
  breakdown: ScoreItem[];
  history: { id: string; score: number; temperature: string; source: 'RULES' | 'MANUAL'; reason: string | null; ruleVersion: number; actor: string | null; createdAt: string }[];
}
export interface ScoringRules { criteria: { key: string; label: string; points: number; enabled: boolean }[]; hotMin: number; warmMin: number }

export interface Assistant {
  enabled: boolean; name: string; businessIdentity: string; businessDescription: string; languages: string[]; tone: string; welcomeMessage: string; systemInstructions: string;
  workingHours: { enabled: boolean; days: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { start: string; end: string } | null> };
  handoverRules: { keywords: string[]; onNegotiation: boolean; onComplaint: boolean; shadowMode?: boolean };
  allowedTools: string[]; model: string | null; temperature: number; maxReplyChars: number; fallbackMessage: string; disclosureText: string; monthlyTokenCap: number | null;
  provider?: 'mock' | 'openai'; killSwitch?: boolean;
}
export interface ShadowStats {
  shadowMode: boolean;
  totalDrafts: number;
  pending: number;
  approvedUnchanged: number;
  edited: number;
  dismissed: number;
  reviewedCount: number;
  accuracyPct: number;
  targetReviews: number;
  minAccuracyPct: number;
  readyForAutopilot: boolean;
}
export interface AiUsage { used: number; inputTokens: number; outputTokens: number; runs: number; cap: number; pct: number; warning: boolean; exceeded: boolean; resetsAt: string; killSwitch: boolean }
export interface AiRun { id: string; conversationId: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED'; model: string | null; promptVersion: string; inputTokens: number; outputTokens: number; latencyMs: number | null; error: string | null; tools: { name: string; ok: boolean }[]; guardViolations: string[]; outcome: string | null; createdAt: string }
export interface KnowledgeDoc { id: string; title: string; filename: string; mime: string; sizeBytes: number; status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'; error: string | null; chunkCount: number; category: string | null; createdAt: string; updatedAt: string }
export interface KnowledgeHit { chunkId: string; documentId: string; title: string; content: string; score: number }

export const TOOL_INFO: { name: string; label: string; help: string; soon?: boolean; sensitive?: boolean }[] = [
  { name: 'get_business_info', label: 'Business information', help: 'Share your contact details and working hours.' },
  { name: 'search_properties', label: 'Search properties', help: 'Look up available units and real prices in your inventory.' },
  { name: 'get_lead_details', label: 'Read lead details', help: 'See what is already known about the customer.' },
  { name: 'update_lead', label: 'Save customer details', help: 'Record budget, area, timeline and requirements the customer shares.' },
  { name: 'calculate_lead_score', label: 'Score the lead', help: 'Recalculate the lead score from saved details.' },
  { name: 'create_followup', label: 'Schedule a follow-up', help: 'Set a follow-up reminder for your team.' },
  { name: 'handover_to_human', label: 'Hand over to a person', help: 'Pass the chat to your team when needed.' },
  { name: 'assign_agent', label: 'Assign to an agent', help: 'Give the lead to the least busy agent.', sensitive: true },
  { name: 'check_availability', label: 'Check availability', help: 'Look up real free appointment times from your team’s working hours and calendars.' },
  { name: 'create_appointment', label: 'Book appointments', help: 'Request an appointment at a time the customer chose. Your team confirms it; double booking is impossible.' },
];
