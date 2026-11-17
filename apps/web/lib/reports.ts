import { API_URL } from './api';

export const REPORTS = [
  { key: 'acquisition', label: 'Lead acquisition', blurb: 'Where leads come from and how many convert.' },
  { key: 'funnel', label: 'Funnel', blurb: 'How far this period\'s leads got through your pipeline.' },
  { key: 'agents', label: 'Agent performance', blurb: 'Leads, wins and appointments per team member.', managerOnly: true },
  { key: 'response', label: 'Response time', blurb: 'How quickly customers get a first reply.' },
  { key: 'appointments', label: 'Appointments', blurb: 'Appointments booked, completed, missed and cancelled.' },
  { key: 'ai', label: 'AI assistant', blurb: 'Turns, handovers, tokens and latency.', managerOnly: true },
  { key: 'automations', label: 'Automations', blurb: 'What ran, what failed and why.', managerOnly: true },
] as const;
export type ReportKey = (typeof REPORTS)[number]['key'];
export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';
export const RANGES: { key: RangeKey; label: string }[] = [{ key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: '7d', label: 'Last 7 days' }, { key: '30d', label: 'Last 30 days' }, { key: 'month', label: 'This month' }, { key: 'custom', label: 'Custom range' }];

export interface ReportTable { name: string; title: string; columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[] }
export interface ReportData { report: ReportKey; range: { label: string; from: string; to: string; timezone: string }; scope: 'all' | 'own'; summary: Record<string, number | string | null>; series: Record<string, Record<string, string | number | null>[]>; tables: ReportTable[] }

export function reportQuery(range: RangeKey, from: string, to: string): string {
  const p = new URLSearchParams({ range });
  if (range === 'custom' && from && to) { p.set('from', new Date(`${from}T00:00:00Z`).toISOString()); p.set('to', new Date(`${to}T00:00:00Z`).toISOString()); }
  return p.toString();
}

/** Downloads a CSV through the authenticated API (the browser carries the session cookie). Throws a readable message on failure. */
export async function downloadReportCsv(key: ReportKey, query: string, table: string): Promise<void> {
  const res = await fetch(`${API_URL}/reports/${key}/export?${query}&table=${encodeURIComponent(table)}`, { credentials: 'include' });
  if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }; throw new Error(j.error?.message ?? 'Export failed'); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = `leadpilot-${key}-${table}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export const fmt = (v: string | number | null | undefined, suffix = ''): string => (v === null || v === undefined ? '-' : typeof v === 'number' ? `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}` : String(v));
