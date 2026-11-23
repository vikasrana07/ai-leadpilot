'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Eye, History, Mail, MailWarning, MousePointerClick, Plus, Search, Send, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Drawer, DrawerContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';
import type {
  EmailEngagementStatsDto,
  EmailSuppressionDto,
  TrackedEmailDetailDto,
  TrackedEmailDto,
} from '@leadpilot/shared-types';

export default function EmailTrackingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'emails' | 'suppressions'>('emails');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  // Suppression modal state
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [suppressEmail, setSuppressEmail] = useState('');
  const [suppressReason, setSuppressReason] = useState<'MANUAL' | 'HARD_BOUNCE' | 'COMPLAINT'>('MANUAL');
  const [suppressNotes, setSuppressNotes] = useState('');

  // 1. Fetch Stats
  const statsQuery = useQuery({
    queryKey: ['emails', 'stats'],
    queryFn: () => api<EmailEngagementStatsDto>('/emails/stats'),
  });

  // 2. Fetch Tracked Emails List
  const emailsQuery = useQuery({
    queryKey: ['emails', 'list', statusFilter, search],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (statusFilter) sp.set('status', statusFilter);
      if (search.trim()) sp.set('q', search.trim());
      return api<{ items: TrackedEmailDto[]; total: number }>('/emails?' + sp.toString());
    },
  });

  // 3. Fetch Suppression List
  const suppressionsQuery = useQuery({
    queryKey: ['emails', 'suppressions', search],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (search.trim()) sp.set('q', search.trim());
      return api<{ items: EmailSuppressionDto[]; total: number }>('/emails/suppressions?' + sp.toString());
    },
    enabled: tab === 'suppressions',
  });

  // 4. Fetch Email Audit Detail
  const emailDetailQuery = useQuery({
    queryKey: ['emails', 'detail', selectedEmailId],
    queryFn: () => api<TrackedEmailDetailDto>(`/emails/${selectedEmailId}`),
    enabled: selectedEmailId !== null,
  });

  // Add suppression mutation
  const addSuppressionMutation = useMutation({
    mutationFn: (body: { email: string; reason: string; notes?: string }) =>
      api('/emails/suppressions', { method: 'POST', body }),
    onSuccess: async () => {
      toast.success('Email added to suppression list');
      setSuppressOpen(false);
      setSuppressEmail('');
      setSuppressNotes('');
      await qc.invalidateQueries({ queryKey: ['emails'] });
    },
    onError: (e) => handleApiError(e),
  });

  // Remove suppression mutation
  const removeSuppressionMutation = useMutation({
    mutationFn: (id: string) => api(`/emails/suppressions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Recipient unsuppressed');
      await qc.invalidateQueries({ queryKey: ['emails'] });
    },
    onError: (e) => handleApiError(e),
  });

  const stats = statsQuery.data;

  const renderStatusBadge = (status: TrackedEmailDto['status']) => {
    switch (status) {
      case 'DELIVERED':
        return <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3 inline" /> Delivered</Badge>;
      case 'OPENED':
        return <Badge tone="primary"><Eye className="mr-1 h-3 w-3 inline" /> Opened</Badge>;
      case 'CLICKED':
        return <Badge tone="primary"><MousePointerClick className="mr-1 h-3 w-3 inline" /> Clicked</Badge>;
      case 'BOUNCED':
        return <Badge tone="danger"><MailWarning className="mr-1 h-3 w-3 inline" /> Bounced</Badge>;
      case 'COMPLAINED':
        return <Badge tone="danger"><ShieldAlert className="mr-1 h-3 w-3 inline" /> Spam Complaint</Badge>;
      case 'SUPPRESSED':
        return <Badge tone="neutral"><Ban className="mr-1 h-3 w-3 inline" /> Suppressed</Badge>;
      case 'SENT':
        return <Badge tone="neutral"><Send className="mr-1 h-3 w-3 inline" /> Sent</Badge>;
      default:
        return <Badge tone="neutral">{status}</Badge>;
    }
  };

  return (
    <>
      <PageHeader
        title="Email Engagement Tracking"
        description="Monitor outbound delivery rates, opens, link clicks, bounces, and reputation suppressions via Amazon SES."
      />

      {/* KPI Stats Bar */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardBody className="p-4">
            <p className="text-helper text-[12px] font-medium uppercase tracking-wider">Delivery Rate</p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight">
                {stats ? `${stats.deliveryRatePercent}%` : <Skeleton className="h-7 w-16" />}
              </span>
              <span className="text-helper text-[12px]">
                {stats ? `${stats.delivered} / ${stats.totalSent} sent` : ''}
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <p className="text-helper text-[12px] font-medium uppercase tracking-wider">Open Rate</p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight">
                {stats ? `${stats.openRatePercent}%` : <Skeleton className="h-7 w-16" />}
              </span>
              <span className="text-helper text-[12px]">
                {stats ? `${stats.opened} unique opens` : ''}
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <p className="text-helper text-[12px] font-medium uppercase tracking-wider">Click Rate</p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight">
                {stats ? `${stats.clickRatePercent}%` : <Skeleton className="h-7 w-16" />}
              </span>
              <span className="text-helper text-[12px]">
                {stats ? `${stats.clicked} link clicks` : ''}
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <p className="text-helper text-[12px] font-medium uppercase tracking-wider">Bounce & Complaints</p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight">
                {stats ? `${stats.bounceRatePercent}%` : <Skeleton className="h-7 w-16" />}
              </span>
              <span className="text-helper text-[12px]">
                {stats ? `${stats.bounced} bounced · ${stats.suppressed} suppressed` : ''}
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        {/* Navigation Tabs */}
        <div role="tablist" aria-label="Email engagement sections" className="flex items-center justify-between border-b border-border px-4">
          <div className="flex gap-2">
            <button
              role="tab"
              aria-selected={tab === 'emails'}
              onClick={() => { setTab('emails'); setSearch(''); }}
              className={cn(
                'relative px-3 py-3 text-[13px] font-medium transition-colors',
                tab === 'emails' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Tracked Outbox
              {tab === 'emails' && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'suppressions'}
              onClick={() => { setTab('suppressions'); setSearch(''); }}
              className={cn(
                'relative px-3 py-3 text-[13px] font-medium transition-colors',
                tab === 'suppressions' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Suppression List
              {tab === 'suppressions' && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          </div>

          {tab === 'suppressions' && (
            <Button size="sm" variant="primary" onClick={() => setSuppressOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Suppress Email
            </Button>
          )}
        </div>

        <CardBody className="space-y-4 p-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tab === 'emails' ? 'Search by recipient or subject…' : 'Search suppressed email…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            {tab === 'emails' && (
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-40"
              >
                <option value="">All Statuses</option>
                <option value="DELIVERED">Delivered</option>
                <option value="OPENED">Opened</option>
                <option value="CLICKED">Clicked</option>
                <option value="BOUNCED">Bounced</option>
                <option value="COMPLAINED">Complaints</option>
                <option value="SUPPRESSED">Suppressed</option>
              </Select>
            )}
          </div>

          {/* TAB 1: Tracked Outbox Table */}
          {tab === 'emails' && (
            <>
              {emailsQuery.isPending ? (
                <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : emailsQuery.data?.items.length === 0 ? (
                <EmptyState
                  icon={Mail}
                  title="No tracked emails found"
                  description="Outbound emails sent to leads from LeadPilot or via Amazon SES will appear here with engagement statistics."
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-border bg-muted/50 text-[12px] font-medium text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5">Subject & Recipient</th>
                        <th className="px-4 py-2.5">Lead</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-center">Opens</th>
                        <th className="px-4 py-2.5 text-center">Clicks</th>
                        <th className="px-4 py-2.5">Sent</th>
                        <th className="px-4 py-2.5 text-right">Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {emailsQuery.data?.items.map((em) => (
                        <tr key={em.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{em.subject}</p>
                            <p className="text-helper text-[12px]">{em.recipient}</p>
                          </td>
                          <td className="px-4 py-3">
                            {em.leadId ? (
                              <Link href={`/leads/${em.leadId}`} className="text-primary hover:underline font-medium">
                                {em.leadName ?? 'View Lead'}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">{renderStatusBadge(em.status)}</td>
                          <td className="px-4 py-3 text-center num font-medium">
                            {em.openCount > 0 ? (
                              <span className="text-primary">{em.openCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center num font-medium">
                            {em.clickCount > 0 ? (
                              <span className="text-primary font-semibold">{em.clickCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-helper whitespace-nowrap">
                            {timeAgo(em.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedEmailId(em.id)}
                            >
                              <History className="mr-1 h-3.5 w-3.5" /> Details
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* TAB 2: Suppression List Table */}
          {tab === 'suppressions' && (
            <>
              {suppressionsQuery.isPending ? (
                <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : suppressionsQuery.data?.items.length === 0 ? (
                <EmptyState
                  icon={ShieldAlert}
                  title="No suppressed email addresses"
                  description="Hard-bounced email addresses and recipients who lodge spam complaints are automatically suppressed to protect SES sender reputation."
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-border bg-muted/50 text-[12px] font-medium text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5">Email</th>
                        <th className="px-4 py-2.5">Reason</th>
                        <th className="px-4 py-2.5">Diagnostic / Source</th>
                        <th className="px-4 py-2.5">Added</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {suppressionsQuery.data?.items.map((s) => (
                        <tr key={s.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-[12px] font-medium">{s.email}</td>
                          <td className="px-4 py-3">
                            <Badge tone={s.reason === 'COMPLAINT' ? 'danger' : s.reason === 'HARD_BOUNCE' ? 'danger' : 'neutral'}>
                              {s.reason.replace('_', ' ')}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-helper text-[12px]">
                            {s.notes ?? s.source}
                          </td>
                          <td className="px-4 py-3 text-helper whitespace-nowrap">
                            {timeAgo(s.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeSuppressionMutation.mutate(s.id)}
                              loading={removeSuppressionMutation.isPending}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* Email Audit History Drawer */}
      <Drawer open={selectedEmailId !== null} onOpenChange={(o) => { if (!o) setSelectedEmailId(null); }}>
        <DrawerContent
          title="Email Engagement Audit"
          description="Detailed lifecycle and event timeline from dispatch to delivery, opens, and link clicks."
          size="lg"
        >
          {emailDetailQuery.isPending ? (
            <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-40" /></div>
          ) : emailDetailQuery.data ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
                <p className="text-[14px] font-semibold">{emailDetailQuery.data.subject}</p>
                <div className="text-[12px] text-muted-foreground space-y-1">
                  <p><strong>Recipient:</strong> {emailDetailQuery.data.recipient}</p>
                  {emailDetailQuery.data.sesMessageId && (
                    <p className="font-mono"><strong>SES Message ID:</strong> {emailDetailQuery.data.sesMessageId}</p>
                  )}
                  <p><strong>Current Status:</strong> {emailDetailQuery.data.status}</p>
                </div>
              </div>

              <div>
                <p className="text-label mb-3 font-semibold">Event Timeline</p>
                {emailDetailQuery.data.events.length === 0 ? (
                  <p className="text-helper">No tracking events recorded yet.</p>
                ) : (
                  <ol className="relative space-y-4 border-l border-border pl-4">
                    {emailDetailQuery.data.events.map((ev) => (
                      <li key={ev.id} className="relative">
                        <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                        <div className="text-[13px]">
                          <p className="font-medium text-foreground">{ev.type}</p>
                          {ev.clickUrl && (
                            <p className="text-[12px] text-primary truncate max-w-sm">Clicked: {ev.clickUrl}</p>
                          )}
                          <p className="text-helper text-[11px]">
                            {new Date(ev.timestamp).toLocaleString()}
                            {ev.ipAddress ? ` · IP: ${ev.ipAddress}` : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>

      {/* Manual Suppression Modal */}
      <Drawer open={suppressOpen} onOpenChange={setSuppressOpen}>
        <DrawerContent title="Suppress Recipient" description="Prevent all future emails from being dispatched to this address." variant="modal">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (suppressEmail.trim()) {
                addSuppressionMutation.mutate({
                  email: suppressEmail.trim(),
                  reason: suppressReason,
                  notes: suppressNotes.trim() || undefined,
                });
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="text-label mb-1 block">Email Address</label>
              <Input
                type="email"
                required
                placeholder="recipient@example.com"
                value={suppressEmail}
                onChange={(e) => setSuppressEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-label mb-1 block">Reason</label>
              <Select
                value={suppressReason}
                onChange={(e) => setSuppressReason(e.target.value as 'MANUAL' | 'HARD_BOUNCE' | 'COMPLAINT')}
              >
                <option value="MANUAL">Manual Suppression (Opt-Out)</option>
                <option value="HARD_BOUNCE">Hard Bounce (Undeliverable)</option>
                <option value="COMPLAINT">Spam Complaint</option>
              </Select>
            </div>
            <div>
              <label className="text-label mb-1 block">Notes (optional)</label>
              <Input
                placeholder="Reason or customer ticket reference"
                value={suppressNotes}
                onChange={(e) => setSuppressNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button type="button" variant="secondary" onClick={() => setSuppressOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={addSuppressionMutation.isPending}>Add to Suppression List</Button>
            </div>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  );
}
