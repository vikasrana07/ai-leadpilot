'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader } from '@/components/page/page-header';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { platformApi, type PlatformAuditRow } from '@/lib/platform';

export default function PlatformAudit() {
  const q = useQuery({ queryKey: ['platform-audit'], queryFn: () => platformApi<PlatformAuditRow[]>('/audit') });
  return (
    <>
      <PageHeader title="Audit log" description="Everything platform staff have done. Append-only." />
      {q.isPending ? <Skeleton className="h-48" /> : (
        <Card className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Admin</th><th className="px-4 py-2 font-medium">Action</th><th className="px-4 py-2 font-medium">Target</th><th className="px-4 py-2 font-medium">Reason</th></tr></thead><tbody>
          {q.data?.map((r) => <tr key={r.id} className="border-b border-border last:border-0"><td className="whitespace-nowrap px-4 py-2">{new Date(r.createdAt).toLocaleString('en-IN')}</td><td className="px-4 py-2">{r.admin ?? '—'}</td><td className="px-4 py-2 font-mono text-[12px]">{r.action}</td><td className="px-4 py-2">{r.tenantId ? <Link className="text-primary hover:underline" href={`/platform/tenants/${r.tenantId}`}>workspace</Link> : r.targetId ?? '—'}</td><td className="px-4 py-2 text-muted-foreground">{r.reason ?? ''}</td></tr>)}
        </tbody></table></Card>
      )}
    </>
  );
}
