import { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, STATE_CODES } from '@leadpilot/validation';
import { ApiError } from './api';

export { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, STATE_CODES };
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type SubStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' | 'INTERNAL';

export interface BillingSummary {
  planKey: string; planName: string; status: SubStatus; restricted: boolean; inGrace: boolean;
  graceEndsAt: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; pendingPlanKey: string | null;
  limits: Record<LimitKey, number | null>; features: Record<FeatureKey, boolean>; usage: Record<LimitKey, number>;
  gstRatePercent: number; priceMinor: number; canManage: boolean; billingProfileComplete: boolean;
  provider: { mode: 'mock' | 'live'; hasPaymentMethod: boolean; lastPaymentFailedAt: string | null };
}
export interface PlanView {
  key: string; name: string; description: string; priceMinor: number; priceWithGstMinor: number; currency: string; trialDays: number;
  limits: Record<LimitKey, number | null>; features: Record<FeatureKey, boolean>;
}
export interface Invoice { id: string; number: string; planKey: string; description: string; issuedAt: string; totalMinor: number; taxableMinor: number; currency: string }
export interface InvoiceParty { legalName: string; gstin: string | null; stateCode: string; address: string }
export interface InvoiceDetail {
  id: string; number: string; issuedAt: string; planKey: string; description: string; periodStart: string | null; periodEnd: string | null; currency: string;
  taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; totalMinor: number; gstRatePercent: number; sac: string; placeOfSupply: string;
  buyer: InvoiceParty; seller: InvoiceParty; paymentId: string | null;
}
export interface BillingProfile { legalName: string; gstin: string | null; stateCode: string; addressLine: string; city: string; pincode: string }
export interface CheckoutInit { subscriptionId: string; keyId: string | null; mode: 'mock' | 'live'; planKey: string; planName: string; amountMinor: number; currency: string; startsAt: string | null }

/** Money is stored in paise. Always full rupees with Indian grouping (never lakh/crore shorthand for money). */
export function inr(minor: number): string {
  const r = minor / 100;
  return `₹${r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const daysLeft = (iso: string | null, now = Date.now()): number => (iso ? Math.ceil((new Date(iso).getTime() - now) / 86_400_000) : 0);
export const limitText = (v: number | null): string => (v === null ? 'Unlimited' : v.toLocaleString('en-IN'));
export const STATUS_LABEL: Record<SubStatus, string> = { TRIALING: 'Free trial', ACTIVE: 'Active', PAST_DUE: 'Payment failed', CANCELED: 'Cancelled', EXPIRED: 'Read-only', INTERNAL: 'Unmetered' };
export const STATUS_TONE: Record<SubStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = { TRIALING: 'primary', ACTIVE: 'success', PAST_DUE: 'warning', CANCELED: 'warning', EXPIRED: 'danger', INTERNAL: 'neutral' };

/** Extras the API puts in `error.details` for 402/409 responses. */
export function problemList(e: unknown): { label: string; used: number; allowed: number }[] {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return [];
  return (e.details as unknown[]).filter((d): d is { label: string; used: number; allowed: number } => typeof d === 'object' && d !== null && 'label' in d && 'used' in d && 'allowed' in d);
}
