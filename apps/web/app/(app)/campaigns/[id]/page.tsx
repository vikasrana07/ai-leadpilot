'use client';

import { use, useState, type ComponentProps } from 'react';
import type { RecipientQuery } from '@leadpilot/validation';
import Link from 'next/link';
import {
  ArrowLeft,
  Play,
  XCircle,
  AlertCircle,
  Search,
  RotateCcw,
  ShieldAlert,
  CornerDownRight,
  Sparkles,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  useCampaign,
  useCampaignRecipients,
  useLaunchCampaign,
  useCancelCampaign,
  useRetryFailed,
  type FollowUpCohort,
} from '@/lib/campaigns';
import { DeliveryGauge } from '@/components/campaigns/delivery-gauge';
import { WhatsAppPreview } from '@/components/campaigns/whatsapp-preview';
import { SendFollowUpDialog } from '@/components/campaigns/send-followup-dialog';

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const campaignQuery = useCampaign(id);
  const recipientsQuery = useCampaignRecipients(id, {
    q: search || undefined,
    status: statusFilter !== 'ALL' ? (statusFilter as RecipientQuery['status']) : undefined,
  });

  const launchMutation = useLaunchCampaign();
  const cancelMutation = useCancelCampaign();
  const retryMutation = useRetryFailed();
  const { can } = useAuth();
  const [retryOpen, setRetryOpen] = useState(false);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpCohort, setFollowUpCohort] = useState<FollowUpCohort>('READ_NO_REPLY');

  const campaign = campaignQuery.data;
  const recipients = recipientsQuery.data?.items || [];

  if (campaignQuery.isLoading) {
    return (
      <div className="p-6 mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-40 bg-muted/50 animate-pulse rounded-xl" />
        <div className="h-96 bg-muted/40 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-12 text-center max-w-md mx-auto space-y-4">
        <AlertCircle className="w-12 h-12 text-danger mx-auto" />
        <h2 className="text-lg font-bold">Campaign not found</h2>
        <Button variant="secondary" asChild>
          <Link href="/campaigns">Back to Campaigns</Link>
        </Button>
      </div>
    );
  }

  const deliveryRate = campaign.sentCount > 0 ? Math.round((campaign.deliveredCount / campaign.sentCount) * 100) : 0;
  const readRate = campaign.deliveredCount > 0 ? Math.round((campaign.readCount / campaign.deliveredCount) * 100) : 0;
  const replyRate = campaign.readCount > 0 ? Math.round(((campaign.repliedCount ?? 0) / campaign.readCount) * 100) : 0;

  const readNoReplyCount = campaign.cohortCounts?.readNoReply ?? Math.max(0, campaign.readCount - (campaign.repliedCount ?? 0));

  const handleLaunch = async () => {
    if (confirm('Launch this campaign now?')) {
      await launchMutation.mutateAsync(id);
    }
  };

  const handleCancel = async () => {
    if (confirm('Cancel this campaign? Pending recipients will be stopped.')) {
      await cancelMutation.mutateAsync(id);
    }
  };

  const campaignTone =
    campaign.status === 'RUNNING'
      ? 'primary'
      : campaign.status === 'COMPLETED'
      ? 'success'
      : campaign.status === 'SCHEDULED'
      ? 'warning'
      : campaign.status === 'CANCELLED'
      ? 'danger'
      : 'neutral';

  return (
    <div className="p-6 mx-auto space-y-6">
      {/* Top Header */}
      <div className="space-y-2">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Broadcast Campaigns
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{campaign.name}</h1>
              <Badge tone={campaignTone as ComponentProps<typeof Badge>['tone']}>
                {campaign.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />}
                {campaign.status}
              </Badge>
              {campaign.parentCampaignId && (
                <Badge tone="neutral" className="gap-1 text-[11px]">
                  <CornerDownRight className="w-3 h-3" />
                  Follow-up ({campaign.followUpCohort?.replace(/_/g, ' ').toLowerCase()})
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              WhatsApp Channel: <strong className="text-foreground">{campaign.channelName}</strong> • Template: <strong className="text-foreground">{campaign.templateName}</strong>
            </p>
          </div>

          <div data-tour="campaign-detail-actions" className="flex items-center gap-2">
            {campaign.status === 'DRAFT' && (
              <Button
                variant="primary"
                onClick={handleLaunch}
                disabled={launchMutation.isPending}
                className="gap-2"
              >
                <Play className="w-4 h-4" />
                Launch Campaign
              </Button>
            )}

            {campaign.status === 'COMPLETED' && can('campaign:manage') && ((campaign.retryableCount ?? 0) > 0 || (campaign.interruptedCount ?? 0) > 0) && (
              <Button className="gap-2" onClick={() => { setIncludeUnknown((campaign.retryableCount ?? 0) === 0); setRetryOpen(true); }}>
                <RotateCcw className="w-4 h-4" />
                Retry failed
              </Button>
            )}

            {campaign.status === 'COMPLETED' && (
              <Button
                variant="primary"
                className="gap-2"
                onClick={() => {
                  setFollowUpCohort('READ_NO_REPLY');
                  setFollowUpOpen(true);
                }}
              >
                <Sparkles className="w-4 h-4" />
                Send a follow-up
              </Button>
            )}

            {(campaign.status === 'SCHEDULED' || campaign.status === 'RUNNING') && (
              <Button
                variant="danger"
                className="gap-2"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
              >
                <XCircle className="w-4 h-4" />
                Cancel Campaign
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={retryOpen}
        onOpenChange={setRetryOpen}
        title="Retry failed messages?"
        description={`${campaign.retryableCount ?? 0} message${(campaign.retryableCount ?? 0) === 1 ? '' : 's'} that failed to send will be tried again. Anyone who has since sent STOP is skipped.`}
        confirmLabel="Retry"
        onConfirm={async () => {
          try {
            const r = await retryMutation.mutateAsync({ id, includeInterrupted: includeUnknown });
            toast.success(`${r.retried} message${r.retried === 1 ? '' : 's'} queued again`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not retry');
          }
        }}
      >
        {(campaign.interruptedCount ?? 0) > 0 ? (
          <label className="mt-3 flex items-start gap-2 rounded-md border border-border p-3 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={includeUnknown} onChange={(e) => setIncludeUnknown(e.target.checked)} />
            <span>
              Also retry {campaign.interruptedCount} message{campaign.interruptedCount === 1 ? '' : 's'} whose delivery is <strong>unknown</strong> (the sender stopped part-way). They may already have been delivered, so retrying can message someone twice.
            </span>
          </label>
        ) : null}
      </ConfirmDialog>

      {/* Send Follow-Up Dialog */}
      <SendFollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        campaign={campaign}
        initialCohort={followUpCohort}
      />

      {/* Campaign Lifecycle Report: Sent -> Delivered -> Read -> Replied */}
      <Card data-tour="campaign-detail-stats" className="border-border/80 bg-gradient-to-br from-card via-card to-card/70 shadow-sm">
        <CardBody className="p-5 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <div data-tour="campaign-detail-actions" className="flex items-center gap-2">
                <Badge tone="success" className="text-[11px] font-semibold">
                  Campaign report
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Audience targeted: <strong>{campaign.totalRecipients.toLocaleString()}</strong>
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                See what every campaign brought back
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
                Each campaign gets its own report. Every reply lands in your team inbox, and you can follow up with the people who read but did not reply.
              </p>
            </div>
          </div>

          {/* Horizontal Funnel KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {/* Sent */}
            <div className="p-4 rounded-xl border border-border/80 bg-muted/20 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sent
              </span>
              <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                {campaign.sentCount.toLocaleString()}
              </p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${campaign.totalRecipients > 0 ? Math.min(100, Math.round((campaign.sentCount / campaign.totalRecipients) * 100)) : 0}%` }}
                />
              </div>
            </div>

            {/* Delivered */}
            <div className="p-4 rounded-xl border border-border/80 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Delivered
                </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {deliveryRate}%
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                {campaign.deliveredCount.toLocaleString()}
              </p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${deliveryRate}%` }}
                />
              </div>
            </div>

            {/* Read */}
            <div className="p-4 rounded-xl border border-border/80 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Read
                </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {readRate}%
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                {campaign.readCount.toLocaleString()}
              </p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${readRate}%` }}
                />
              </div>
            </div>

            {/* Replied */}
            <div className="p-4 rounded-xl border border-border/80 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Replied
                </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {replyRate}%
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                {(campaign.repliedCount ?? 0).toLocaleString()}
              </p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${replyRate}%` }}
                />
              </div>
            </div>
          </div>

          {/* 1-Click Follow Up Callout Card & Opt-Out Counter */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CornerDownRight className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    Follow up with &ldquo;Read, no reply&rdquo;
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Send the same offer again to the {readNoReplyCount.toLocaleString()} people who read it but did not reply.
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  setFollowUpCohort('READ_NO_REPLY');
                  setFollowUpOpen(true);
                }}
                className="shrink-0 gap-1.5 shadow-sm"
              >
                Send follow-up
              </Button>
            </div>

            {/* Isolated Opt-Out Counter Card */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/80 bg-card">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-foreground">
                  Opted out from this campaign
                </span>
                <p className="text-[11px] text-muted-foreground">
                  Sent STOP after receiving this broadcast
                </p>
              </div>
              <span className="text-2xl font-extrabold text-foreground">
                {campaign.optOutCount.toLocaleString()}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Grid: Delivery Gauge (Smart Retries) & Interactive WhatsApp Smartphone Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Delivery Gauge & Targeting Specs */}
        <div className="lg:col-span-7 space-y-6">
          <DeliveryGauge
            sentCount={campaign.sentCount}
            deliveredCount={campaign.deliveredCount}
            autoRetry={campaign.autoRetry}
            autoRetryCount={campaign.autoRetryCount ?? 0}
            nextRetryAt={campaign.nextRetryAt}
            status={campaign.status}
          />

          {/* Targeting & Compliance Rules Card */}
          <Card data-tour="campaign-detail-recipients">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Audience Segmentation & Opt-In Status
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-xs text-muted-foreground">
              <div className="grid grid-cols-2 gap-2 pb-2 border-b">
                <div>
                  <span className="block text-[11px] text-muted-foreground">Lead Stages</span>
                  <strong className="text-foreground">
                    {campaign.segment.stageIds?.length ? `${campaign.segment.stageIds.length} stages selected` : 'All Stages'}
                  </strong>
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground">Lead Temperatures</span>
                  <strong className="text-foreground">
                    {campaign.segment.temperatures?.length ? campaign.segment.temperatures.join(', ') : 'All Temperatures'}
                  </strong>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-1.5 text-foreground font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Everyone who replies shows up in your team inbox, ready to answer.</span>
                </div>
                <div className="flex items-center gap-1.5 text-foreground font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>People who opt out because of this campaign are counted as Opted Out.</span>
                </div>
                <div className="flex items-center gap-1.5 text-foreground font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Kept apart from people who had already opted out and were never sent it.</span>
                </div>
              </div>

              {campaign.noConsentCount > 0 && (
                <p className="text-muted-foreground flex items-center gap-1 font-medium pt-2">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {campaign.noConsentCount} leads skipped because they have not opted in to WhatsApp marketing.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right Column: Live WhatsApp Mobile Preview */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full mb-3 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Live WhatsApp Preview
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">
              Verified Business View
            </span>
          </div>

          <WhatsAppPreview
            businessName={campaign.channelName || 'Your Store'}
            templateName={campaign.templateName}
            bodyText={campaign.templateBodyPreview || 'Hi! Check out our exclusive campaign offer.'}
            showCustomerReply={Boolean(campaign.repliedCount && campaign.repliedCount > 0)}
          />
        </div>
      </div>

      {/* Recipients List Table */}
      <Card data-tour="campaign-detail-recipients">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
          <div>
            <CardTitle className="text-base font-semibold">Campaign Recipients</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live delivery, read receipt, and customer reply attribution for each contact.
            </p>
          </div>

          <div data-tour="campaign-detail-actions" className="flex items-center gap-2">
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search phone or name..."
                className="h-8 pl-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="h-8 px-2.5 rounded-md border border-input bg-background text-xs ring-offset-background"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="SENT">Sent</option>
              <option value="DELIVERED">Delivered</option>
              <option value="READ">Read</option>
              <option value="FAILED">Failed</option>
              <option value="SKIPPED_OPT_OUT">Skipped (Opt-Out)</option>
            </select>
          </div>
        </CardHeader>

        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/40 border-y text-muted-foreground font-medium">
                <tr>
                  <th className="py-2.5 px-4">Lead Name</th>
                  <th className="py-2.5 px-4">Phone</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Sent At</th>
                  <th className="py-2.5 px-4">Delivered At</th>
                  <th className="py-2.5 px-4">Read At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {recipientsQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">Loading recipients...</td>
                  </tr>
                ) : recipients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      No recipients matching current filter.
                    </td>
                  </tr>
                ) : (
                  recipients.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-4 font-medium text-foreground">
                        {r.conversationId ? (
                          <Link
                            href={`/inbox?conversationId=${r.conversationId}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {r.leadName}
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </Link>
                        ) : (
                          r.leadName
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-muted-foreground">{r.phone}</td>
                      <td className="py-2.5 px-4">
                        <Badge
                          tone={
                            r.status === 'READ'
                              ? 'success'
                              : r.status === 'DELIVERED'
                              ? 'primary'
                              : r.status === 'SENT'
                              ? 'neutral'
                              : r.status === 'FAILED'
                              ? 'danger'
                              : r.status === 'SKIPPED_OPT_OUT'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">{r.sentAt ? new Date(r.sentAt).toLocaleTimeString() : '—'}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{r.deliveredAt ? new Date(r.deliveredAt).toLocaleTimeString() : '—'}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{r.readAt ? new Date(r.readAt).toLocaleTimeString() : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
