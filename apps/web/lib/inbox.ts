import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface ConversationItem {
  id: string; status: 'OPEN' | 'CLOSED'; mode: 'AI' | 'HUMAN';
  channel: { id: string; type: 'WHATSAPP' | 'WEB_WIDGET'; name: string };
  lead: { id: string; name: string; phone: string | null; email: string | null; score: number | null; temperature: string } | null;
  assignee: { id: string; name: string } | null;
  lastMessageAt: string; preview: string | null; unreadCount: number; tags: string[]; windowOpen: boolean; windowExpiresAt: string | null;
}
export interface ConversationList { items: ConversationItem[]; total: number; page: number; pageSize: number; unreadTotal: number }
export interface ConversationDetail {
  id: string; status: 'OPEN' | 'CLOSED'; mode: 'AI' | 'HUMAN'; channel: { id: string; type: 'WHATSAPP' | 'WEB_WIDGET'; name: string; status: string };
  tags: string[]; unreadCount: number; windowOpen: boolean; windowExpiresAt: string | null; whatsappConsent: 'OPTED_IN' | 'OPTED_OUT' | null; whatsappMarketingConsent: 'ELIGIBLE' | 'OPTED_OUT' | 'NO_CONSENT'; assignee: { id: string; name: string } | null;
  lead: { id: string; name: string; phone: string | null; email: string | null; stage: { name: string; kind: string }; source: string | null; temperature: string; score: number | null; budgetMin: number | null; budgetMax: number | null; location: string | null; propertyType: string | null; buyingTimeline: string; assignee: { id: string; name: string } | null } | null;
}
export interface ChatMessage {
  id: string; direction: 'INBOUND' | 'OUTBOUND'; senderType: 'CUSTOMER' | 'AGENT' | 'AI' | 'SYSTEM'; sender: string | null; type: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'TEMPLATE';
  body: string | null; media: { id: string; mime?: string; filename?: string; caption?: string } | null; status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  error: { message?: string; retryable?: boolean } | null; createdAt: string;
}
export interface WaTemplate { id: string; name: string; language: string; bodyPreview: string; variableCount: number; source?: 'manual' | 'meta'; approvalStatus?: string | null }

export const useUnreadCount = (enabled: boolean) => useQuery({
  queryKey: ['conversations', 'unread'], enabled, staleTime: 15_000,
  queryFn: () => api<ConversationList>('/conversations?status=OPEN&unread=true&pageSize=1').then((r) => r.unreadTotal),
});
