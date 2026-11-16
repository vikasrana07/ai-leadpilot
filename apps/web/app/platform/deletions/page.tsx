'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader } from '@/components/page/page-header';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { platformApi } from '@/lib/platform';

interface DeletionRequest { id: string; tenantId: string; tenantName: string; tenantEmail: string; reason: string; requestedAt: string; purgeAfter: string }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function PlatformDeletions() {
  const q = useQuery({ queryKey: ['platform-deletions'], queryFn: () => platformApi<DeletionRequest[]>('/deletion-requests') });
  return (
    <>
      <PageHeader title="Deletion requests" description="Workspaces whose owners asked for permanent deletion. They are read-only until the date shown, then purged automatically by the worker (owners can cancel before then)." />
      {q.isPending ? <Skeleton className="h-32" /> : q.data && q.data.length === 0 ? <Card className="p-6 text-[13px] text-muted-foreground">No deletions are pending.</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-4 py-2 font-medium">Workspace</th><th className="px-4 py-2 font-medium">Requested</th><th className="px-4 py-2 font-medium">Purged on</th><th className="px-4 py-2 font-medium">Reason given</th></tr></thead>
            <tbody>
              {q.data?.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2"><Link className="font-medium underline" href={`/platform/tenants/${r.tenantId}`}>{r.tenantName}</Link><div className="text-muted-foreground">{r.tenantEmail}</div></td>
                  <td className="whitespace-nowrap px-4 py-2">{fmt(r.requestedAt)}</td><td className="whitespace-nowrap px-4 py-2">{fmt(r.purgeAfter)}</td><td className="px-4 py-2">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
