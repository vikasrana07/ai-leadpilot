'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtDate } from '@/lib/billing';
import { platformApi, type PlatformPlan, type PlatformTenantRow } from '@/lib/platform';

export default function PlatformTenants() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [plan, setPlan] = useState('');
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => platformApi<PlatformPlan[]>('/plans') });
  const qs = new URLSearchParams({ limit: '100', ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}), ...(plan ? { plan } : {}) }).toString();
  const q = useQuery({ queryKey: ['platform-tenants', qs], queryFn: () => platformApi<PlatformTenantRow[]>(`/tenants?${qs}`) });
  return (
    <>
      <PageHeader title="Tenants" description="All workspaces on the platform." />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name or email" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select>
        <Select className="w-40" aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">All plans</option>{plans.data?.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select>
      </div>
      {q.isPending ? <Skeleton className="h-48" /> : (
        <Card className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-4 py-2 font-medium">Workspace</th><th className="px-4 py-2 font-medium">Plan</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Subscription</th><th className="px-4 py-2 text-right font-medium">Seats</th><th className="px-4 py-2 text-right font-medium">Leads</th><th className="px-4 py-2 font-medium">Created</th></tr></thead><tbody>
          {q.data?.map((t) => <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/50"><td className="px-4 py-2"><Link className="font-medium text-primary hover:underline" href={`/platform/tenants/${t.id}`}>{t.name}</Link><div className="text-helper">{t.email}</div></td><td className="px-4 py-2">{t.planKey}</td><td className="px-4 py-2"><Badge tone={t.status === 'ACTIVE' ? 'success' : 'danger'}>{t.status}</Badge></td><td className="px-4 py-2">{t.subscriptionStatus ?? '—'}{t.provider === 'manual' ? ' (complimentary)' : ''}</td><td className="num px-4 py-2 text-right">{t.seats}</td><td className="num px-4 py-2 text-right">{t.leads.toLocaleString('en-IN')}</td><td className="px-4 py-2">{fmtDate(t.createdAt)}</td></tr>)}
          {q.data?.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-helper">No workspaces match.</td></tr> : null}
        </tbody></table></Card>
      )}
    </>
  );
}
