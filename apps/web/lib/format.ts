/** Indian number formatting: lakh / crore for large amounts. */
export function formatINR(amount: number | null | undefined, opts: { compact?: boolean } = { compact: true }): string {
  if (amount === null || amount === undefined) return '—';
  if (opts.compact !== false) {
    if (amount >= 1e7) return `₹${trim(amount / 1e7)} Cr`;
    if (amount >= 1e5) return `₹${trim(amount / 1e5)} L`;
  }
  return `₹${amount.toLocaleString('en-IN')}`;
}
const trim = (n: number) => (Math.round(n * 100) / 100).toString();

export function formatBudget(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—';
  if (min !== null && max !== null) return min === max ? formatINR(min) : `${formatINR(min)} – ${formatINR(max)}`;
  return min !== null ? `${formatINR(min)}+` : `Up to ${formatINR(max)}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 0) return `in ${humanize(-s)}`;
  if (s < 45) return 'just now';
  return `${humanize(s)} ago`;
}
function humanize(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export const TIMELINE_LABELS: Record<string, string> = {
  UNKNOWN: 'Not known', IMMEDIATE: 'Immediately', WITHIN_30_DAYS: 'Within 30 days', ONE_TO_THREE_MONTHS: '1 – 3 months', THREE_TO_SIX_MONTHS: '3 – 6 months', SIX_PLUS_MONTHS: '6+ months',
};
export const TEMPERATURE_LABELS: Record<string, string> = { HOT: 'Hot', WARM: 'Warm', COLD: 'Cold', UNKNOWN: 'Unscored' };
