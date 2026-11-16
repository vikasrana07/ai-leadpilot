import type { LeadDto, StageKind } from '@leadpilot/shared-types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Stage { id: string; key: string; name: string; position: number; kind: StageKind; qualifies: boolean; canCloseWon: boolean; leadCount: number }
export interface LostReason { id: string; name: string; active: boolean }
export interface LeadMeta {
  sources: { id: string; key: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  customFields: { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'boolean'; options: string[]; required: boolean }[];
}
export interface Member { id: string; status: string; roleKey: string; roleName: string; user: { id: string; name: string; email: string } }
export interface DuplicateInfo { id: string; name: string; phone: string | null; email: string | null; stage: string }

export const useStages = () => useQuery({ queryKey: ['pipeline', 'stages'], queryFn: () => api<{ stages: Stage[]; lostReasons: LostReason[] }>('/pipeline/stages'), staleTime: 60_000 });
export const useLeadMeta = () => useQuery({ queryKey: ['leads', 'meta'], queryFn: () => api<LeadMeta>('/leads/meta'), staleTime: 60_000 });
export const useMembers = () => useQuery({ queryKey: ['team', 'members'], queryFn: () => api<Member[]>('/team/members'), staleTime: 60_000 });

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export type { LeadDto };
