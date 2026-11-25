'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  Building2,
  ExternalLink,
  FileText,
  Search,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import { platformApi, type PlatformAuditRow } from '@/lib/platform';

function getActionTone(action: string) {
  if (action.includes('suspend') || action.includes('failed') || action.includes('delete')) {
    return 'danger' as const;
  }
  if (action.includes('plan') || action.includes('assign') || action.includes('update')) {
    return 'warning' as const;
  }
  if (action.includes('login') || action.includes('reactivate') || action.includes('verify')) {
    return 'success' as const;
  }
  return 'neutral' as const;
}

export default function PlatformAudit() {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['platform-audit'],
    queryFn: () => platformApi<PlatformAuditRow[]>('/audit'),
  });

  const rows = q.data ?? [];
  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.action.toLowerCase().includes(s) ||
      (r.admin && r.admin.toLowerCase().includes(s)) ||
      (r.reason && r.reason.toLowerCase().includes(s)) ||
      (r.tenantId && r.tenantId.toLowerCase().includes(s))
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Audit Log"
        description="Immutable, append-only record of all administrative actions, staff interventions, and security authentications."
      />

      {/* Filter and Search Bar */}
      <Card className="p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 pr-8"
            placeholder="Filter audit log by action, admin, reason, or workspace..."
            aria-label="Search audit log"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </Card>

      {q.isPending ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground">
            Loading audit events...
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-24 rounded-md" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="text-[15px] font-semibold text-foreground">No Audit Records Found</h3>
          <p className="text-helper mt-1 text-[13px]">
            {search
              ? 'No audit entries matched your filter.'
              : 'Audit log is currently empty.'}
          </p>
          {search && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => setSearch('')}
            >
              Reset Search
            </Button>
          )}
        </Card>
      ) : (
        <Card className="overflow-x-auto shadow-sm">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="px-5 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Admin / Actor</th>
                <th className="px-4 py-3 font-medium">Action Event</th>
                <th className="px-4 py-3 font-medium">Target Context</th>
                <th className="px-5 py-3 font-medium">Recorded Reason / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground text-[12px] font-mono">
                    {new Date(r.createdAt).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Avatar name={r.admin ?? 'System'} size={24} />
                      <span className="font-medium text-foreground">
                        {r.admin ?? <span className="text-muted-foreground italic">System Internal</span>}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <Badge tone={getActionTone(r.action)} className="font-mono text-[11px]">
                      {r.action}
                    </Badge>
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {r.tenantId ? (
                      <Link
                        href={`/platform/tenants/${r.tenantId}`}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        <span>Workspace</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : r.targetId ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {r.targetId}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>

                  <td className="px-5 py-3.5 text-muted-foreground text-[13px] leading-relaxed">
                    {r.reason ? (
                      <span className="text-foreground">{r.reason}</span>
                    ) : (
                      <span className="text-muted-foreground/50 italic">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
