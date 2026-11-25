'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Download, ScrollText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api, API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Entry { id: string; action: string; actorUserId: string | null; resourceType: string | null; resourceId: string | null; metadata: Record<string, unknown>; ip: string | null; createdAt: string }
interface Page { items: Entry[]; nextCursor: string | null }

const FILTERS = [
  { value: '', label: 'All events' }, { value: 'auth.login', label: 'Sign-ins' }, { value: 'sso.login', label: 'SSO sign-ins' },
  { value: 'sso.configured', label: 'SSO changes' }, { value: 'audit.worm_exported', label: 'WORM exports' },
  { value: 'team.invited', label: 'Invitations' }, { value: 'team.role_changed', label: 'Role changes' },
  { value: 'tenant.updated', label: 'Workspace changes' },
];

export default function AuditPage() {
  const { can } = useAuth();
  const [action, setAction] = useState('');
  const [exporting, setExporting] = useState(false);

  async function downloadWormExport() {
    setExporting(true);
    try {
      const res = await fetch(`${API_URL}/audit-logs/export`, { credentials: 'include' });
      if (!res.ok) throw new Error('Could not export audit logs');
      const rootHash = res.headers.get('x-audit-chain-root') ?? '';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-worm-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(rootHash ? `Signed WORM export downloaded (root: ${rootHash.slice(0, 12)}…)` : 'Signed WORM export downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }
  const q = useInfiniteQuery({
    queryKey: ['audit', action],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => api<Page>(`/audit-logs?limit=25${action ? `&action=${encodeURIComponent(action)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: can('audit:read'),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Audit logs" description="A tamper-resistant record of sensitive actions in this workspace." actions={
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Filter events" value={action} onChange={(e) => setAction(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-[13px]">
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {can('audit:read') ? (
            <Button size="sm" variant="secondary" loading={exporting} onClick={() => void downloadWormExport()} title="Download SHA-256 hash-chained & HMAC-signed WORM JSONL archive">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
              <Download className="h-3.5 w-3.5" aria-hidden />
              Signed WORM export
            </Button>
          ) : null}
        </div>
      } />
      <Card className="overflow-hidden">
        {q.isPending ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-xs text-label text-muted-foreground shadow-xs">
                <tr><th className="px-5 py-2.5 font-medium">When</th><th className="px-5 py-2.5 font-medium">Event</th><th className="px-5 py-2.5 font-medium">Details</th><th className="px-5 py-2.5 font-medium">IP</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-5 py-3"><Skeleton className="h-3.5 w-24" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-5 w-24 rounded" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-3.5 w-48" /></td>
                    <td className="px-5 py-3"><Skeleton className="h-3.5 w-20 font-mono text-xs" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={ScrollText} title="No events yet" description="Sign-ins, invitations, role changes and settings updates will be recorded here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-xs text-label text-muted-foreground shadow-xs"><tr><th className="px-5 py-2.5 font-medium">When</th><th className="px-5 py-2.5 font-medium">Event</th><th className="px-5 py-2.5 font-medium">Details</th><th className="px-5 py-2.5 font-medium">IP</th></tr></thead>
              <tbody className="divide-y divide-border">
                {items.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/40">
                    <td className="num whitespace-nowrap px-5 py-2.5 text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="px-5 py-2.5"><Badge tone={e.action.includes('failed') || e.action.includes('reuse') ? 'danger' : 'neutral'} className="font-mono">{e.action}</Badge></td>
                    <td className="max-w-xs truncate px-5 py-2.5 text-muted-foreground">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : '—'}</td>
                    <td className="num px-5 py-2.5 text-muted-foreground">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.hasNextPage ? <div className="border-t border-border p-3 text-center"><Button variant="ghost" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button></div> : null}
      </Card>
    </>
  );
}
