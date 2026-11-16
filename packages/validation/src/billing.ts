import { z } from 'zod';

// ----------------------------------------------------------------------------- entitlements catalogue
/** Numeric limits. A plan row with `limit: null` and `enabled: true` means unlimited. */
export const LIMIT_KEYS = ['seats', 'ai_tokens_monthly', 'whatsapp_messages_monthly', 'active_automations', 'knowledge_mb'] as const;
/** On/off features. */
export const FEATURE_KEYS = ['ai_assistant', 'automations', 'web_widget', 'csv_export'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export const ENTITLEMENT_LABELS: Record<LimitKey | FeatureKey, string> = {
  seats: 'Team seats', ai_tokens_monthly: 'AI tokens / month', whatsapp_messages_monthly: 'WhatsApp messages sent / month (fair use)', active_automations: 'Active automations', knowledge_mb: 'Knowledge base storage (MB)',
  ai_assistant: 'AI assistant', automations: 'Automations', web_widget: 'Website chat widget', csv_export: 'CSV export',
};

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'] as const;
export type SubscriptionStatusKey = (typeof SUBSCRIPTION_STATUSES)[number];

export const GST_RATE_PERCENT = 18;
/** Days an unpaid renewal keeps working before the workspace becomes read-only. */
export const DEFAULT_GRACE_DAYS = 7;

// ----------------------------------------------------------------------------- GST
/** 15 chars: 2-digit state code, 10-char PAN, entity digit, 'Z', checksum. Format check only; we do not call the GSTN portal. */
export const GSTIN_REGEX = /^(0[1-9]|[1-2][0-9]|3[0-9])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar',
  '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

export const billingProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN').nullable().default(null),
  stateCode: z.string().regex(/^\d{2}$/).refine((c) => c in STATE_CODES, 'Unknown GST state code'),
  addressLine: z.string().trim().min(5).max(300),
  city: z.string().trim().max(80).default(''),
  pincode: z.string().trim().regex(/^$|^\d{6}$/, 'Use a 6-digit pincode').default(''),
}).superRefine((v, ctx) => {
  if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode) ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'State must match the first two digits of the GSTIN' });
});
export type BillingProfileInput = z.infer<typeof billingProfileSchema>;

/** Splits a GST-inclusive amount into taxable value and tax. Intra-state supply: CGST + SGST halves; inter-state: IGST. All in paise. */
export function splitGst(totalMinor: number, ratePercent: number, intraState: boolean): { taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; totalMinor: number } {
  const taxable = Math.round((totalMinor * 100) / (100 + ratePercent));
  const tax = totalMinor - taxable;
  if (!intraState) return { taxableMinor: taxable, cgstMinor: 0, sgstMinor: 0, igstMinor: tax, totalMinor };
  const cgst = Math.floor(tax / 2);
  return { taxableMinor: taxable, cgstMinor: cgst, sgstMinor: tax - cgst, igstMinor: 0, totalMinor };
}
/** Price shown to a customer is ex-GST; the provider charges the GST-inclusive amount. */
export function withGst(priceMinor: number, ratePercent: number = GST_RATE_PERCENT): number { return Math.round((priceMinor * (100 + ratePercent)) / 100); }
/** Indian financial year label for a date, e.g. 2026-27 (April to March) in IST. */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear(); const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ----------------------------------------------------------------------------- tenant billing API
export const subscribeSchema = z.object({ planKey: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/) });
export const cancelSubscriptionSchema = z.object({ reason: z.string().trim().max(500).optional() });

// ----------------------------------------------------------------------------- platform admin API
const entitlementInput = z.object({ key: z.enum([...LIMIT_KEYS, ...FEATURE_KEYS]), enabled: z.boolean(), limit: z.number().int().min(0).max(1_000_000_000).nullable() });
export const planInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  priceMinor: z.number().int().min(0).max(100_000_000),
  trialDays: z.number().int().min(0).max(90).default(0),
  isPublic: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(100),
  /** Every catalogue key exactly once: a plan can never be silently missing a limit. */
  entitlements: z.array(entitlementInput).max(20).superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((e, i) => { if (seen.has(e.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'Duplicate entitlement' }); seen.add(e.key); });
    for (const k of [...LIMIT_KEYS, ...FEATURE_KEYS]) if (!seen.has(k)) ctx.addIssue({ code: 'custom', message: `Missing entitlement: ${k}` });
  }),
});
export type PlanInput = z.infer<typeof planInputSchema>;
export const planUpdateSchema = planInputSchema.omit({ key: true }).partial();

export const platformLoginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(128) });
export const platformReasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (min 5 characters)').max(500) });
export const platformAssignPlanSchema = z.object({
  planKey: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  mode: z.enum(['complimentary', 'trial']),
  days: z.number().int().min(1).max(365).optional(),
  reason: z.string().trim().min(5).max(500),
});
export const platformTenantsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), plan: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
