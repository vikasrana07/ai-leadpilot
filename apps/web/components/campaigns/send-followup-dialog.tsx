'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CornerDownRight, Info, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { useCreateFollowUp, useWhatsAppTemplates, type CampaignDetail, type FollowUpCohort } from '@/lib/campaigns';

interface SendFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: CampaignDetail;
  initialCohort?: FollowUpCohort;
}

const COHORT_OPTIONS: Array<{
  id: FollowUpCohort;
  label: string;
  description: string;
  countKey: keyof NonNullable<CampaignDetail['cohortCounts']>;
}> = [
  {
    id: 'FAILED',
    label: 'Failed to send',
    description: 'Recipients where message sending failed or was rejected.',
    countKey: 'failed',
  },
  {
    id: 'SENT_UNDELIVERED',
    label: 'Sent, not delivered',
    description: 'Sent into WhatsApp network but not yet delivered to the phone.',
    countKey: 'sentNotDelivered',
  },
  {
    id: 'DELIVERED_UNREAD',
    label: 'Delivered, not read',
    description: 'Delivered to phone with double-grey ticks, but unread.',
    countKey: 'deliveredNotRead',
  },
  {
    id: 'READ_NO_REPLY',
    label: 'Read, no reply',
    description: 'Read (blue ticks) by recipient, but no reply was sent back.',
    countKey: 'readNoReply',
  },
  {
    id: 'REPLIED',
    label: 'Replied',
    description: 'Contacts who replied to this campaign offer.',
    countKey: 'replied',
  },
];

export function SendFollowUpDialog({
  open,
  onOpenChange,
  campaign,
  initialCohort = 'READ_NO_REPLY',
}: SendFollowUpDialogProps) {
  const router = useRouter();
  const [selectedCohort, setSelectedCohort] = useState<FollowUpCohort>(initialCohort);
  const [name, setName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(campaign.templateId);
  const [autoRetry, setAutoRetry] = useState(true);

  const createFollowUpMutation = useCreateFollowUp(campaign.id);
  const templatesQuery = useWhatsAppTemplates();

  const cohortCounts = campaign.cohortCounts ?? {
    failed: campaign.failedCount ?? 0,
    sentNotDelivered: Math.max(0, campaign.sentCount - campaign.deliveredCount),
    deliveredNotRead: Math.max(0, campaign.deliveredCount - campaign.readCount),
    readNoReply: Math.max(0, campaign.readCount - (campaign.repliedCount ?? 0)),
    replied: campaign.repliedCount ?? 0,
  };

  const selectedOption = COHORT_OPTIONS.find((c) => c.id === selectedCohort);
  const currentCount = selectedOption ? cohortCounts[selectedOption.countKey] : 0;

  const handleCreate = async () => {
    try {
      const res = await createFollowUpMutation.mutateAsync({
        cohort: selectedCohort,
        name: name.trim() || undefined,
        templateId: selectedTemplateId !== campaign.templateId ? selectedTemplateId : undefined,
        autoRetry,
      });

      toast.success('Follow-up campaign created');
      onOpenChange(false);
      router.push(`/campaigns/${res.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create follow-up campaign');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Send a follow-up"
        description="From a finished campaign, send the same template again to a group you pick."
        size="xl"
        variant="modal"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <CornerDownRight className="w-3.5 h-3.5" />
              Follow-up will target <strong>{currentCount}</strong> contacts
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)} type="button">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={createFollowUpMutation.isPending || currentCount === 0}
                className="gap-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {createFollowUpMutation.isPending ? 'Creating...' : 'Create follow-up'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5 pt-2">
          {/* Cohort Radio Options List */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              Pick Recipient Cohort
            </label>
            <div className="space-y-2">
              {COHORT_OPTIONS.map((opt) => {
                const count = cohortCounts[opt.countKey];
                const isSelected = selectedCohort === opt.id;

                return (
                  <label
                    key={opt.id}
                    onClick={() => setSelectedCohort(opt.id)}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border/70 hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="followup_cohort"
                        checked={isSelected}
                        onChange={() => setSelectedCohort(opt.id)}
                        className="mt-1 h-4 w-4 border-muted-foreground text-primary focus:ring-primary"
                      />
                      <div>
                        <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                      </div>
                    </div>
                    <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    }`}>
                      {count.toLocaleString()}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Campaign Name Override */}
          <Field
            label="Follow-up Campaign Name"
            htmlFor="followup-campaign-name"
            hint="Optional custom name for your new follow-up campaign."
          >
            <Input
              id="followup-campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${campaign.name} - Follow up (${selectedOption?.label})`}
              className="text-xs"
            />
          </Field>

          {/* Template Selection */}
          <Field
            label="Template"
            htmlFor="followup-template-select"
            hint="Choose which approved WhatsApp template to dispatch to this cohort."
          >
            <select
              id="followup-template-select"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={campaign.templateId}>
                Same template: {campaign.templateName} ({campaign.templateLanguage})
              </option>
              {templatesQuery.data
                ?.filter((t) => t.id !== campaign.templateId && t.approvalStatus === 'APPROVED')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.language}) — {t.category}
                  </option>
                ))}
            </select>
          </Field>

          {/* Smart Auto-Retry Toggle */}
          <div className="flex items-center justify-between rounded-xl border border-border/80 bg-muted/20 p-3.5">
            <div className="space-y-0.5 max-w-[80%]">
              <span className="text-xs font-semibold text-foreground">Smart Auto-Retry</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Automatically retry delivery for recipients held back by transient WhatsApp rate limits after 24h & 48h.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoRetry}
                onChange={(e) => setAutoRetry(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Informational Callout */}
          <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
            <span>
              The follow-up is created as its own campaign, so the first campaign&apos;s results stay preserved as they were.
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
