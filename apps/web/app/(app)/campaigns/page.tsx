'use client';

import { useState, type ComponentProps } from 'react';
import Link from 'next/link';
import {
  Megaphone,
  Plus,
  Play,
  XCircle,
  Clock,
  CheckCircle2,
  Eye,
  Send,
  Users,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateCampaignDialog } from '@/components/campaigns/create-campaign-dialog';
import {
  useCampaigns,
  useLaunchCampaign,
  useCancelCampaign,
  type CampaignItem,
} from '@/lib/campaigns';

const STATUS_FILTERS = ['ALL', 'RUNNING', 'SCHEDULED', 'COMPLETED', 'DRAFT', 'CANCELLED'] as const;

export default function CampaignsPage() {
  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]>('ALL');
  const [createOpen, setCreateOpen] = useState(false);

  const campaignsQuery = useCampaigns(filter);
  const launchMutation = useLaunchCampaign();
  const cancelMutation = useCancelCampaign();

  const campaigns = campaignsQuery.data?.items || [];

  // Summary Metrics calculations
  const totalSent = campaigns.reduce((acc, c) => acc + c.sentCount, 0);
  const totalDelivered = campaigns.reduce((acc, c) => acc + c.deliveredCount, 0);
  const totalRead = campaigns.reduce((acc, c) => acc + c.readCount, 0);
  const totalOptOuts = campaigns.reduce((acc, c) => acc + c.optOutCount, 0);

  const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;
  const readRate = totalDelivered > 0 ? Math.round((totalRead / totalDelivered) * 100) : 0;

  const handleLaunch = async (id: string) => {
    if (confirm('Are you sure you want to launch this campaign now? Messages will begin dispatching.')) {
      await launchMutation.mutateAsync(id);
    }
  };

  const handleCancel = async (id: string) => {
    if (confirm('Are you sure you want to cancel this campaign? Any pending messages will be halted.')) {
      await cancelMutation.mutateAsync(id);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Megaphone className="w-6 h-6 text-primary" />
            WhatsApp Broadcast Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Send bulk approved WhatsApp templates to targeted lead cohorts with automatic opt-out suppression.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Campaign
        </Button>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/70 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Sent
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" />
              {totalSent.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Across all campaigns</p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Delivery Rate
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              {deliveryRate}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">{totalDelivered.toLocaleString()} delivered</p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Read Rate
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
              <Eye className="w-5 h-5" />
              {readRate}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">{totalRead.toLocaleString()} read</p>
          </CardBody>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Opt-Outs Suppressed
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              {totalOptOuts.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Protected from spam flags</p>
          </CardBody>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b pb-2 overflow-x-auto">
        {STATUS_FILTERS.map((s) => {
          const active = filter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                active ? 'bg-secondary text-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {s === 'ALL' ? 'All Campaigns' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>

      {/* Campaigns Listing */}
      {campaignsQuery.isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-muted/40 animate-pulse border" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
          <h3 className="text-base font-semibold text-foreground">No broadcast campaigns found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Create your first broadcast to reach qualified leads with promotional property alerts.
          </p>
          <Button variant="primary" onClick={() => setCreateOpen(true)} className="mt-4 gap-2">
            <Plus className="w-4 h-4" />
            Create Campaign
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => (
            <CampaignRow
              key={c.id}
              campaign={c}
              onLaunch={handleLaunch}
              onCancel={handleCancel}
              isLaunching={launchMutation.isPending}
              isCancelling={cancelMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void campaignsQuery.refetch();
        }}
      />
    </div>
  );
}

function CampaignRow({
  campaign,
  onLaunch,
  onCancel,
  isLaunching,
  isCancelling,
}: {
  campaign: CampaignItem;
  onLaunch: (id: string) => void;
  onCancel: (id: string) => void;
  isLaunching: boolean;
  isCancelling: boolean;
}) {
  const percentSent = campaign.totalRecipients > 0 ? Math.round((campaign.sentCount / campaign.totalRecipients) * 100) : 0;
  const percentDelivered = campaign.sentCount > 0 ? Math.round((campaign.deliveredCount / campaign.sentCount) * 100) : 0;
  const percentRead = campaign.deliveredCount > 0 ? Math.round((campaign.readCount / campaign.deliveredCount) * 100) : 0;

  const tone =
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
    <Card className="hover:border-primary/40 transition-all shadow-sm">
      <CardBody className="p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Left: Info */}
          <div className="space-y-1.5 min-w-[280px]">
            <div className="flex items-center gap-2.5">
              <Link
                href={`/campaigns/${campaign.id}`}
                className="text-base font-semibold hover:text-primary transition-colors hover:underline"
              >
                {campaign.name}
              </Link>
              <Badge tone={tone as ComponentProps<typeof Badge>['tone']} className="gap-1 text-[11px] font-medium">
                {campaign.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                {campaign.status}
              </Badge>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span>Channel: <strong className="text-foreground">{campaign.channelName}</strong></span>
              <span>•</span>
              <span>Template: <strong className="text-foreground">{campaign.templateName}</strong></span>
              <span>•</span>
              <span>Created {new Date(campaign.createdAt).toLocaleDateString()}</span>
              {campaign.scheduledAt && campaign.status === 'SCHEDULED' && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1 text-primary font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    Scheduled for {new Date(campaign.scheduledAt).toLocaleString()}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Middle: Metrics & Progress */}
          <div className="flex-1 max-w-md space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-muted-foreground">
                Progress: <strong className="text-foreground">{campaign.sentCount}</strong> / {campaign.totalRecipients} ({percentSent}%)
              </span>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {percentDelivered}% delivered
                </span>
                <span className="text-blue-600 dark:text-blue-400 font-medium">
                  {percentRead}% read
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden flex">
              <div
                className="bg-primary transition-all duration-500"
                style={{ width: `${percentSent}%` }}
              />
            </div>

            {campaign.noConsentCount > 0 && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" />
                {campaign.noConsentCount} leads skipped (no opt-in)
              </p>
            )}

            {campaign.optOutCount > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" />
                {campaign.optOutCount} leads suppressed due to opt-out
              </p>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {campaign.status === 'DRAFT' && (
              <Button
                variant="primary"
                className="gap-1.5 h-8 text-xs"
                disabled={isLaunching}
                onClick={() => onLaunch(campaign.id)}
              >
                <Play className="w-3.5 h-3.5" />
                Launch Now
              </Button>
            )}

            {(campaign.status === 'SCHEDULED' || campaign.status === 'RUNNING') && (
              <Button
                variant="danger"
                className="gap-1.5 h-8 text-xs"
                disabled={isCancelling}
                onClick={() => onCancel(campaign.id)}
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel
              </Button>
            )}

            <Button variant="ghost" className="h-8 text-xs" asChild>
              <Link href={`/campaigns/${campaign.id}`} className="gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Recipients
              </Link>
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
