'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  AlertTriangle,
  Clock,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import { platformApi } from '@/lib/platform';

interface DeletionRequest {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  reason: string;
  requestedAt: string;
  purgeAfter: string;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function getDaysRemaining(purgeAfterIso: string) {
  const diff = new Date(purgeAfterIso).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days;
}

export default function PlatformDeletions() {
  const q = useQuery({
    queryKey: ['platform-deletions'],
    queryFn: () => platformApi<DeletionRequest[]>('/deletion-requests'),
  });

  const pendingCount = q.data?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending Workspace Deletions"
        description="Workspaces marked for permanent GDPR / self-service account termination. Workspaces remain read-only during the cooling-off window until purged by the automated background cleaner."
      />

      {/* Info Warning Card */}
      <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft/50 p-4 text-[13px] text-foreground">
        <AlertTriangle className="h-5 w-5 shrink-0 text-warning mt-0.5" />
        <div>
          <p className="font-semibold text-warning">Automated Purge Grace Period</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
            Owners can cancel deletion at any time before the scheduled purge date. Once purged, all leads, automations, WhatsApp logs, and activity records are irreversibly deleted from the database.
          </p>
        </div>
      </div>

      {q.isPending ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground">
            Loading deletion requests...
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
        </Card>
      ) : pendingCount === 0 ? (
        <Card className="p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
            <Trash2 className="h-6 w-6" />
          </div>
          <h3 className="text-[15px] font-semibold text-foreground">No Pending Deletion Requests</h3>
          <p className="text-helper mt-1 max-w-sm mx-auto text-[13px]">
            There are currently no tenant workspaces queued for termination or automated data purge.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto shadow-sm">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="px-5 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Requested On</th>
                <th className="px-4 py-3 font-medium">Scheduled Purge</th>
                <th className="px-4 py-3 font-medium">Reason Given</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data?.map((r) => {
                const days = getDaysRemaining(r.purgeAfter);
                return (
                  <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.tenantName} size={32} />
                        <div className="min-w-0">
                          <Link
                            href={`/platform/tenants/${r.tenantId}`}
                            className="font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
                          >
                            <span className="truncate">{r.tenantName}</span>
                          </Link>
                          <p className="truncate text-[12px] text-muted-foreground">
                            {r.tenantEmail}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground text-[12px]">
                      {fmt(r.requestedAt)}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Badge tone={days <= 2 ? 'danger' : 'warning'}>
                          <Clock className="h-3 w-3 mr-1" />
                          {days <= 0 ? 'Purge imminent' : `In ${days} ${days === 1 ? 'day' : 'days'}`}
                        </Badge>
                        <span className="text-[12px] text-muted-foreground font-mono">
                          {fmt(r.purgeAfter)}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-foreground leading-relaxed">
                      {r.reason ? (
                        <span className="italic text-muted-foreground">"{r.reason}"</span>
                      ) : (
                        <span className="text-muted-foreground/60">No specific reason provided</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
