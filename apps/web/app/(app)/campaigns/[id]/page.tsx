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
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  useCampaign,
  useCampaignRecipients,
  useLaunchCampaign,
  useCancelCampaign,
  type RecipientItem,
} from '@/lib/campaigns';

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

  const campaign = campaignQuery.data;
  const recipients = recipientsQuery.data?.items || [];

  if (campaignQuery.isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
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
            </div>
            <p className="text-xs text-muted-foreground">
              WhatsApp Channel: <strong className="text-foreground">{campaign.channelName}</strong> • Template: <strong className="text-foreground">{campaign.templateName}</strong>
            </p>
          </div>

          <div className="flex items-center gap-2">
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="bg-card/70 border-border/60">
          <CardHeader className="p-3 pb-1 border-none">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase">Targeted</CardTitle>
          </CardHeader>
          <CardBody className="p-3 pt-0">
            <p className="text-xl font-bold text-foreground">{campaign.totalRecipients}</p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 border-border/60">
          <CardHeader className="p-3 pb-1 border-none">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase">Sent</CardTitle>
          </CardHeader>
          <CardBody className="p-3 pt-0">
            <p className="text-xl font-bold text-foreground">{campaign.sentCount}</p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 border-border/60">
          <CardHeader className="p-3 pb-1 border-none">
            <CardTitle className="text-[11px] font-medium text-success uppercase">Delivered</CardTitle>
          </CardHeader>
          <CardBody className="p-3 pt-0">
            <p className="text-xl font-bold text-success">
              {campaign.deliveredCount} <span className="text-xs font-normal text-muted-foreground">({deliveryRate}%)</span>
            </p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 border-border/60">
          <CardHeader className="p-3 pb-1 border-none">
            <CardTitle className="text-[11px] font-medium text-primary uppercase">Read</CardTitle>
          </CardHeader>
          <CardBody className="p-3 pt-0">
            <p className="text-xl font-bold text-primary">
              {campaign.readCount} <span className="text-xs font-normal text-muted-foreground">({readRate}%)</span>
            </p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 border-border/60">
          <CardHeader className="p-3 pb-1 border-none">
            <CardTitle className="text-[11px] font-medium text-danger uppercase">Failed</CardTitle>
          </CardHeader>
          <CardBody className="p-3 pt-0">
            <p className="text-xl font-bold text-danger">{campaign.failedCount}</p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 border-border/60">
          <CardHeader className="p-3 pb-1 border-none">
            <CardTitle className="text-[11px] font-medium text-warning uppercase">Opt-Outs</CardTitle>
          </CardHeader>
          <CardBody className="p-3 pt-0">
            <p className="text-xl font-bold text-warning">{campaign.optOutCount}</p>
          </CardBody>
        </Card>
      </div>

      {/* Template & Filters summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {campaign.templateBodyPreview && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Template Preview</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-xs font-mono whitespace-pre-wrap bg-muted/50 p-3 rounded-lg border text-foreground/90">
                {campaign.templateBodyPreview}
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Audience Targeting Filters</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1.5 text-xs text-muted-foreground">
            <p>Stages: <strong className="text-foreground">{campaign.segment.stageIds?.length ? `${campaign.segment.stageIds.length} stages selected` : 'All Stages'}</strong></p>
            <p>Temperatures: <strong className="text-foreground">{campaign.segment.temperatures?.length ? campaign.segment.temperatures.join(', ') : 'All Temperatures'}</strong></p>
            {(campaign.segment.minScore !== undefined || campaign.segment.maxScore !== undefined) && (
              <p>Score Range: <strong className="text-foreground">{campaign.segment.minScore ?? 0} - {campaign.segment.maxScore ?? 100}</strong></p>
            )}
            {campaign.noConsentCount > 0 && (
              <p className="text-muted-foreground flex items-center gap-1 font-medium pt-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                {campaign.noConsentCount} leads skipped because they have not opted in to WhatsApp marketing.
              </p>
            )}
            {campaign.optOutCount > 0 && (
              <p className="text-warning flex items-center gap-1 font-medium pt-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                {campaign.optOutCount} leads automatically skipped due to WhatsApp opt-out consent.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Recipients List Table */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
          <div>
            <CardTitle className="text-base font-semibold">Campaign Recipients</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live delivery and read receipt status for each contact.
            </p>
          </div>

          <div className="flex items-center gap-2">
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
                    <RecipientRow key={r.id} recipient={r} />
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

function RecipientRow({ recipient }: { recipient: RecipientItem }) {
  const getBadge = (status: RecipientItem['status']) => {
    switch (status) {
      case 'READ':
        return <Badge tone="primary">Read</Badge>;
      case 'DELIVERED':
        return <Badge tone="success">Delivered</Badge>;
      case 'SENT':
        return <Badge tone="neutral">Sent</Badge>;
      case 'FAILED':
        return <Badge tone="danger">Failed</Badge>;
      case 'SKIPPED_OPT_OUT':
        return <Badge tone="warning">Skipped (Opt-Out)</Badge>;
      case 'PENDING':
      default:
        return <Badge tone="neutral">Pending</Badge>;
    }
  };

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="py-2.5 px-4 font-medium text-foreground">{recipient.leadName}</td>
      <td className="py-2.5 px-4 font-mono text-muted-foreground">{recipient.phone}</td>
      <td className="py-2.5 px-4">{getBadge(recipient.status)}</td>
      <td className="py-2.5 px-4 text-muted-foreground">
        {recipient.sentAt ? new Date(recipient.sentAt).toLocaleTimeString() : '—'}
      </td>
      <td className="py-2.5 px-4 text-muted-foreground">
        {recipient.deliveredAt ? new Date(recipient.deliveredAt).toLocaleTimeString() : '—'}
      </td>
      <td className="py-2.5 px-4 text-muted-foreground">
        {recipient.readAt ? new Date(recipient.readAt).toLocaleTimeString() : '—'}
      </td>
    </tr>
  );
}
