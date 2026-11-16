'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { UsageView } from '@/lib/ops';
import { cn } from '@/lib/cn';

const n = (v: number) => v.toLocaleString('en-IN');
const bytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="flex items-baseline justify-between gap-3 py-2 text-[13px]"><span className="text-muted-foreground" title={hint}>{label}</span><span className="num font-medium">{value}</span></div>;
}

export default function UsagePage() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api<UsageView>('/usage') });
  if (q.isPending) return <><PageHeader title="Usage" /><Skeleton className="h-64" /></>;
  if (q.isError) return <><PageHeader title="Usage" /><Card><EmptyState icon={Gauge} title="Could not load usage" description="Please try again." action={<Button onClick={() => void q.refetch()}>Retry</Button>} /></Card></>;
  const u = q.data;
  const period = new Intl.DateTimeFormat('en-IN', { timeZone: u.period.timezone, month: 'long', year: 'numeric' }).format(new Date(u.period.from));
  return (
    <>
      <PageHeader title="Usage" description={`${period}. Counts only: nothing here limits or bills you yet.`} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>AI assistant</CardTitle></CardHeader><CardBody>
          <div className="mb-2 flex items-center justify-between text-[13px]"><span>{n(u.ai.tokensUsed)} of {n(u.ai.cap)} tokens</span>{u.ai.exceeded ? <Badge tone="danger">Limit reached: chats are handed to your team</Badge> : u.ai.warning ? <Badge tone="warning">Over 80%</Badge> : <Badge tone="success">{u.ai.pct}%</Badge>}</div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={u.ai.pct} aria-valuemin={0} aria-valuemax={100} aria-label="AI token usage"><div className={cn('h-full rounded-full', u.ai.exceeded ? 'bg-danger' : u.ai.warning ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(2, u.ai.pct)}%` }} /></div>
          <div className="mt-2 divide-y divide-border"><Row label="AI turns" value={n(u.ai.runs)} /><Row label="Input tokens" value={n(u.ai.inputTokens)} /><Row label="Output tokens" value={n(u.ai.outputTokens)} /></div></CardBody></Card>
        <Card><CardHeader><CardTitle>Messages</CardTitle></CardHeader><CardBody><div className="divide-y divide-border"><Row label="Received from customers" value={n(u.messages.inbound)} /><Row label="Sent by the AI assistant" value={n(u.messages.aiReplies)} /><Row label="Sent by your team" value={n(u.messages.agentReplies)} /><Row label="Template messages from automations" value={n(u.messages.automatedTemplates)} hint="WhatsApp conversation fees are billed by Meta to your own WhatsApp account." /></div><p className="text-helper mt-2">WhatsApp conversation fees are billed by Meta directly to your WhatsApp Business account, not by LeadPilot.</p></CardBody></Card>
        <Card><CardHeader><CardTitle>Work</CardTitle></CardHeader><CardBody><div className="divide-y divide-border"><Row label="Leads created" value={n(u.leads.created)} /><Row label="Appointments created" value={n(u.appointments.created)} /><Row label="Automation runs completed" value={n(u.automations.succeeded)} /><Row label="Automation runs skipped" value={n(u.automations.skipped)} /><Row label="Automation runs failed" value={n(u.automations.failed)} /></div></CardBody></Card>
        <Card><CardHeader><CardTitle>Workspace</CardTitle></CardHeader><CardBody><div className="divide-y divide-border"><Row label="Active team members" value={n(u.seats.active)} /><Row label="Knowledge documents" value={n(u.storage.documents)} /><Row label="Document storage" value={bytes(u.storage.bytes)} /></div></CardBody></Card>
      </div>
    </>
  );
}
