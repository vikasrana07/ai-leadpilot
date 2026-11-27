'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Database, HeartPulse, Radio, RefreshCw, Server, XCircle } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { platformApi, type OpsView } from '@/lib/platform';

interface ReadyStatus {
  status: string;
  db?: string;
  redis?: string;
}

export default function PlatformHealthPage() {
  const ready = useQuery({
    queryKey: ['platform', 'health-ready'],
    queryFn: () => api<ReadyStatus>('/health/ready'),
    refetchInterval: 30_000,
    retry: false,
  });

  const ops = useQuery({
    queryKey: ['platform', 'ops'],
    queryFn: () => platformApi<OpsView>('/ops'),
    refetchInterval: 30_000,
  });

  const refreshAll = () => {
    void ready.refetch();
    void ops.refetch();
  };

  const healthy = ready.isSuccess && (ops.data?.firing.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform health"
        description="Live readiness checks for API, PostgreSQL, Redis, and background workers."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={refreshAll}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/platform/ops">Open Ops Status</Link>
            </Button>
          </div>
        }
      />

      {ready.isPending && ops.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <HeartPulse className="h-4 w-4 text-primary" aria-hidden />
                Overall
              </CardTitle>
              <Badge tone={healthy ? 'success' : 'danger'}>{healthy ? 'Healthy' : 'Degraded'}</Badge>
            </CardHeader>
            <CardBody className="text-[13px] text-muted-foreground">
              {ops.data ? `${ops.data.firing.length} firing alert(s)` : 'Checking alerts…'}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Database className="h-4 w-4 text-primary" aria-hidden />
                Database
              </CardTitle>
              {ready.isSuccess ? (
                <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden />Connected</Badge>
              ) : (
                <Badge tone="danger"><XCircle className="h-3 w-3" aria-hidden />Unreachable</Badge>
              )}
            </CardHeader>
            <CardBody className="text-[13px] text-muted-foreground">PostgreSQL primary + RLS</CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Radio className="h-4 w-4 text-primary" aria-hidden />
                Redis &amp; Pub/Sub
              </CardTitle>
              <Badge tone={ready.data?.redis === 'ok' || ready.isSuccess ? 'success' : 'warning'}>
                {ready.data?.redis ?? (ready.isSuccess ? 'Connected' : 'Unknown')}
              </Badge>
            </CardHeader>
            <CardBody className="text-[13px] text-muted-foreground">BullMQ queues &amp; SSE events</CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Server className="h-4 w-4 text-primary" aria-hidden />
                Workers
              </CardTitle>
              <Badge tone={(ops.data?.workers.alive ?? 0) > 0 ? 'success' : 'warning'}>
                {ops.data?.workers.alive ?? 0} alive
              </Badge>
            </CardHeader>
            <CardBody className="text-[13px] text-muted-foreground">
              Outbox pending: {ops.data?.health?.outbox.pending ?? 0}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
