import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  AudiencePreviewInput,
  CampaignSegment,
  CampaignTemplateParam,
  CreateCampaignInput,
  CreateFollowUpInput,
  FollowUpCohort,
  RecipientQuery,
  UpdateCampaignInput,
} from '@leadpilot/validation';
import { FOLLOW_UP_COHORTS } from '@leadpilot/validation';

export { FOLLOW_UP_COHORTS, type FollowUpCohort, type CreateFollowUpInput };

export interface CampaignItem {
  id: string;
  name: string;
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  channelId: string;
  channelName: string;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  segment: CampaignSegment;
  templateParams: CampaignTemplateParam[];
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  repliedCount: number;
  failedCount: number;
  optOutCount: number;
  noConsentCount: number;
  autoRetry?: boolean;
  autoRetryCount?: number;
  nextRetryAt?: string | null;
  parentCampaignId?: string | null;
  followUpCohort?: FollowUpCohort | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignListResponse {
  items: CampaignItem[];
  nextCursor: string | null;
}

export interface CampaignDetail extends CampaignItem {
  templateBodyPreview?: string;
  /** Failed recipients a retry would re-send, and those whose delivery state is unknown (re-sending them can message someone twice). */
  retryableCount?: number;
  interruptedCount?: number;
  cohortCounts?: {
    failed: number;
    sentNotDelivered: number;
    deliveredNotRead: number;
    readNoReply: number;
    replied: number;
  };
}

export interface RecipientItem {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  status: 'PENDING' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED_OPT_OUT' | 'SKIPPED_NO_CONSENT';
  conversationId: string | null;
  messageId: string | null;
  externalId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  error?: { message?: string } | null;
  createdAt: string;
}

export interface RecipientListResponse {
  items: RecipientItem[];
  nextCursor: string | null;
}

export interface AudiencePreviewResponse {
  totalMatching: number;
  eligibleCount: number;
  optOutCount: number;
  noConsentCount: number;
  sampleLeads: Array<{
    id: string;
    name: string;
    phone: string | null;
    score: number | null;
    stageName: string;
    isOptedOut: boolean;
    consent: 'ELIGIBLE' | 'OPTED_OUT' | 'NO_CONSENT';
  }>;
}

export const OPT_IN_BASES = [
  { value: 'existing_customer', label: 'Existing customer who agreed' },
  { value: 'signed_form_or_checkbox', label: 'Signed form or checkbox' },
  { value: 'verbal_recorded', label: 'Verbal, recorded in my notes' },
  { value: 'other', label: 'Other (explain in lead notes)' },
] as const;

export interface WaChannelItem {
  id: string;
  name: string;
  type: string;
  externalId: string | null;
  status: string;
}

export interface WaTemplateItem {
  id: string;
  name: string;
  language: string;
  category: string;
  bodyPreview: string;
  variableCount: number;
  approvalStatus: string | null;
}

export function useCampaigns(status?: string, cursor?: string) {
  return useQuery({
    queryKey: ['campaigns', { status, cursor }],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (status && status !== 'ALL') sp.set('status', status);
      if (cursor) sp.set('cursor', cursor);
      return api<CampaignListResponse>(`/campaigns?${sp.toString()}`);
    },
    staleTime: 10_000,
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => api<CampaignDetail>(`/campaigns/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === 'RUNNING' ? 3000 : false;
    },
  });
}

export function useCampaignRecipients(id: string, query?: Partial<RecipientQuery>) {
  return useQuery({
    queryKey: ['campaigns', id, 'recipients', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query?.status) sp.set('status', query.status);
      if (query?.q) sp.set('q', query.q);
      if (query?.cursor) sp.set('cursor', query.cursor);
      if (query?.limit) sp.set('limit', String(query.limit));
      return api<RecipientListResponse>(`/campaigns/${id}/recipients?${sp.toString()}`);
    },
    enabled: Boolean(id),
  });
}

export function useWhatsAppChannels() {
  return useQuery({
    queryKey: ['channels', 'whatsapp'],
    queryFn: async () => {
      const res = await api<WaChannelItem[]>('/channels');
      return res.filter((ch) => ch.type === 'WHATSAPP' && ch.status === 'ACTIVE');
    },
  });
}

export function useWhatsAppTemplates() {
  return useQuery({
    queryKey: ['channels', 'templates'],
    queryFn: () => api<WaTemplateItem[]>('/channels/whatsapp/templates'),
  });
}

export function useAudiencePreview() {
  return useMutation({
    mutationFn: (input: AudiencePreviewInput) => api<AudiencePreviewResponse>('/campaigns/preview', {
      method: 'POST',
      body: input,
    }),
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) => api<{ id: string; status: string }>('/campaigns', {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useUpdateCampaign(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCampaignInput) => api<{ id: string; status: string }>(`/campaigns/${id}`, {
      method: 'PATCH',
      body: input,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns', id] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useLaunchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; status: string }>(`/campaigns/${id}/launch`, {
      method: 'POST',
    }),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['campaigns', id] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useRetryFailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, includeInterrupted }: { id: string; includeInterrupted: boolean }) => api<{ id: string; status: string; retried: number }>(`/campaigns/${id}/retry-failed`, {
      method: 'POST',
      body: { includeInterrupted },
    }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['campaigns', id] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useCancelCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; status: string }>(`/campaigns/${id}/cancel`, {
      method: 'POST',
    }),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['campaigns', id] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useCreateFollowUp(parentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFollowUpInput) => api<{ id: string; status: string }>(`/campaigns/${parentId}/follow-up`, {
      method: 'POST',
      body: input,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns', parentId] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
