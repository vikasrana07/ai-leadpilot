'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import {
  useCreateCampaign,
  useWhatsAppChannels,
  useWhatsAppTemplates,
  useAudiencePreview,
} from '@/lib/campaigns';
import { useStages } from '@/lib/crm';
import { AlertTriangle, CheckCircle, Users } from 'lucide-react';
import type { CampaignSegment, CampaignTemplateParam } from '@leadpilot/validation';

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function CreateCampaignDialog({ open, onOpenChange, onCreated }: CreateCampaignDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templateParams, setTemplateParams] = useState<CampaignTemplateParam[]>([]);
  const [scheduleType, setScheduleType] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  // Audience filters
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [selectedTemps, setSelectedTemps] = useState<string[]>([]);
  const [minScore, setMinScore] = useState<number | ''>('');
  const [maxScore, setMaxScore] = useState<number | ''>('');

  const channelsQuery = useWhatsAppChannels();
  const templatesQuery = useWhatsAppTemplates();
  const stagesQuery = useStages();

  const previewMutation = useAudiencePreview();
  const createMutation = useCreateCampaign();

  // Selected template object
  const selectedTemplate = templatesQuery.data?.find((t) => t.id === templateId);

  // Auto-select first channel
  useEffect(() => {
    if (channelsQuery.data?.length && !channelId) {
      setChannelId(channelsQuery.data[0]!.id);
    }
  }, [channelsQuery.data, channelId]);

  // When template changes, initialize parameter mappings
  useEffect(() => {
    if (selectedTemplate) {
      const count = selectedTemplate.variableCount || 0;
      const initial: CampaignTemplateParam[] = [];
      for (let i = 1; i <= count; i++) {
        initial.push({
          index: i,
          field: i === 1 ? 'name' : 'custom',
          customValue: '',
          fallback: 'Valued Customer',
        });
      }
      setTemplateParams(initial);
    } else {
      setTemplateParams([]);
    }
  }, [selectedTemplate]);

  // Audience preview trigger
  const runPreview = () => {
    const segment: CampaignSegment = {
      stageIds: selectedStages,
      tagIds: [],
      sourceIds: [],
      temperatures: selectedTemps as any,
      ...(minScore !== '' ? { minScore: Number(minScore) } : {}),
      ...(maxScore !== '' ? { maxScore: Number(maxScore) } : {}),
    };
    previewMutation.mutate({ segment, channelId });
  };

  useEffect(() => {
    if (step === 3) {
      runPreview();
    }
  }, [step, selectedStages, selectedTemps, minScore, maxScore]);

  const handleSubmit = async () => {
    if (!name.trim() || !channelId || !templateId) return;

    const segment: CampaignSegment = {
      stageIds: selectedStages,
      tagIds: [],
      sourceIds: [],
      temperatures: selectedTemps as any,
      ...(minScore !== '' ? { minScore: Number(minScore) } : {}),
      ...(maxScore !== '' ? { maxScore: Number(maxScore) } : {}),
    };

    const scheduledDate = scheduleType === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : null;

    try {
      const res = await createMutation.mutateAsync({
        name: name.trim(),
        channelId,
        templateId,
        templateParams,
        segment,
        scheduledAt: scheduledDate,
      });
      onOpenChange(false);
      // Reset
      setStep(1);
      setName('');
      if (onCreated) onCreated(res.id);
    } catch {
      // Error handled by mutation state
    }
  };

  const stagesList = stagesQuery.data?.stages || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="2xl"
        title="New Broadcast Campaign"
        description="Blast WhatsApp templates to segmented leads with automated opt-out suppression."
        footer={
          <div className="flex justify-between items-center w-full">
            {step > 1 ? (
              <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as any)}>
                Back
              </Button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {step < 4 ? (
                <Button
                  variant="primary"
                  disabled={
                    (step === 1 && (!name.trim() || !channelId)) ||
                    (step === 2 && !templateId) ||
                    (step === 3 && previewMutation.data?.eligibleCount === 0)
                  }
                  onClick={() => setStep((s) => (s + 1) as any)}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={createMutation.isPending || (scheduleType === 'later' && !scheduledAt)}
                  onClick={handleSubmit}
                >
                  {createMutation.isPending ? 'Creating...' : scheduleType === 'now' ? 'Create & Launch' : 'Schedule Campaign'}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="py-2 space-y-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2 border-b">
            <span className={`px-2 py-0.5 rounded-full ${step === 1 ? 'bg-primary text-white font-medium' : 'bg-muted'}`}>1. Details</span>
            <span>→</span>
            <span className={`px-2 py-0.5 rounded-full ${step === 2 ? 'bg-primary text-white font-medium' : 'bg-muted'}`}>2. Template</span>
            <span>→</span>
            <span className={`px-2 py-0.5 rounded-full ${step === 3 ? 'bg-primary text-white font-medium' : 'bg-muted'}`}>3. Audience</span>
            <span>→</span>
            <span className={`px-2 py-0.5 rounded-full ${step === 4 ? 'bg-primary text-white font-medium' : 'bg-muted'}`}>4. Schedule</span>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <Field label="Campaign Name" htmlFor="campaign-name">
                <Input
                  id="campaign-name"
                  placeholder="e.g. Sobha Ivory Launch - Exclusive Preview"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </Field>

              <Field label="Sender WhatsApp Channel" htmlFor="channel-id">
                <select
                  id="channel-id"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-primary"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  <option value="" disabled>Select WhatsApp Channel</option>
                  {(channelsQuery.data || []).map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} {ch.externalId ? `(${ch.externalId})` : ''}
                    </option>
                  ))}
                </select>
                {channelsQuery.data?.length === 0 && (
                  <p className="text-xs text-danger mt-1">
                    No active WhatsApp channels found. Please connect WhatsApp in Integrations first.
                  </p>
                )}
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Field label="Pre-Approved WhatsApp Template" htmlFor="template-id">
                <select
                  id="template-id"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-primary"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="" disabled>Select pre-approved template</option>
                  {(templatesQuery.data || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} [{t.language}] - {t.category} ({t.variableCount} vars)
                    </option>
                  ))}
                </select>
              </Field>

              {selectedTemplate && (
                <div className="p-3 bg-muted/60 border rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Template Body Preview:</span>
                    <Badge tone="success">{selectedTemplate.approvalStatus || 'APPROVED'}</Badge>
                  </div>
                  <p className="text-sm font-mono whitespace-pre-wrap text-foreground/90 bg-background/80 p-2.5 rounded border">
                    {selectedTemplate.bodyPreview}
                  </p>
                </div>
              )}

              {templateParams.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Variable Parameter Mappings ({templateParams.length})
                  </h4>
                  {templateParams.map((param, idx) => (
                    <div key={param.index} className="flex items-center gap-3 p-2.5 border rounded-md bg-muted/30">
                      <span className="font-mono text-xs font-bold text-primary shrink-0 w-12">
                        {`{{${param.index}}}`}
                      </span>
                      <select
                        className="h-8 px-2 rounded border bg-background text-xs"
                        value={param.field}
                        onChange={(e) => {
                          const updated = [...templateParams];
                          updated[idx] = { ...param, field: e.target.value as any };
                          setTemplateParams(updated);
                        }}
                      >
                        <option value="name">Lead Name</option>
                        <option value="phone">Phone Number</option>
                        <option value="email">Email</option>
                        <option value="location">Location</option>
                        <option value="propertyType">Property Type</option>
                        <option value="custom">Static Text</option>
                      </select>

                      {param.field === 'custom' ? (
                        <Input
                          placeholder="Static text value..."
                          className="h-8 text-xs flex-1"
                          value={param.customValue || ''}
                          onChange={(e) => {
                            const updated = [...templateParams];
                            updated[idx] = { ...param, customValue: e.target.value };
                            setTemplateParams(updated);
                          }}
                        />
                      ) : (
                        <Input
                          placeholder="Fallback if empty (e.g. Customer)"
                          className="h-8 text-xs flex-1"
                          value={param.fallback || ''}
                          onChange={(e) => {
                            const updated = [...templateParams];
                            updated[idx] = { ...param, fallback: e.target.value };
                            setTemplateParams(updated);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Filter by Pipeline Stages" htmlFor="stage-filter">
                  <div id="stage-filter" className="max-h-32 overflow-y-auto border rounded-md p-2 space-y-1 bg-background text-xs">
                    {stagesList.map((stage) => {
                      const checked = selectedStages.includes(stage.id);
                      return (
                        <label key={stage.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedStages(checked ? selectedStages.filter((s) => s !== stage.id) : [...selectedStages, stage.id]);
                            }}
                          />
                          <span>{stage.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Filter by Lead Temperature" htmlFor="temp-filter">
                  <div id="temp-filter" className="flex flex-wrap gap-2 pt-1">
                    {['HOT', 'WARM', 'COLD'].map((temp) => {
                      const checked = selectedTemps.includes(temp);
                      return (
                        <button
                          key={temp}
                          type="button"
                          onClick={() => {
                            setSelectedTemps(checked ? selectedTemps.filter((t) => t !== temp) : [...selectedTemps, temp]);
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                            checked ? 'bg-primary text-white border-primary shadow-sm' : 'bg-background hover:bg-muted text-muted-foreground'
                          }`}
                        >
                          {temp}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Min AI Lead Score (0 - 100)" htmlFor="min-score">
                  <Input
                    id="min-score"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="e.g. 50"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </Field>
                <Field label="Max AI Lead Score" htmlFor="max-score">
                  <Input
                    id="max-score"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="e.g. 100"
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </Field>
              </div>

              {/* Real-time Audience Preview Card */}
              <div className="p-4 rounded-xl border bg-card/60 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    <h4 className="text-sm font-semibold">Estimated Audience Size</h4>
                  </div>
                  {previewMutation.isPending && (
                    <span className="text-xs text-muted-foreground animate-pulse">Calculating...</span>
                  )}
                </div>

                {previewMutation.data && (
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-2.5 rounded-lg bg-muted/40 border">
                      <p className="text-xs text-muted-foreground font-medium">Total Matched</p>
                      <p className="text-lg font-bold text-foreground">{previewMutation.data.totalMatching}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Eligible to Send</p>
                      <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{previewMutation.data.eligibleCount}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Suppressed (Opt-Out)</p>
                      <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{previewMutation.data.optOutCount}</p>
                    </div>
                  </div>
                )}

                {previewMutation.data?.optOutCount ? (
                  <div className="flex items-start gap-2 p-2 bg-amber-500/10 rounded border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-warning mt-0.5" />
                    <span>
                      {previewMutation.data.optOutCount} leads sent STOP/UNSUBSCRIBE and will be safely suppressed to protect your WhatsApp Business phone quality rating.
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <Field label="Dispatch Schedule" htmlFor="schedule-dispatch">
                <div id="schedule-dispatch" className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setScheduleType('now')}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      scheduleType === 'now' ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'hover:bg-muted'
                    }`}
                  >
                    <p className="font-semibold text-sm">Send Immediately</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Campaign will be launched right after creation.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScheduleType('later')}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      scheduleType === 'later' ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'hover:bg-muted'
                    }`}
                  >
                    <p className="font-semibold text-sm">Schedule for Later</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Set a future date and time for automatic dispatch.
                    </p>
                  </button>
                </div>
              </Field>

              {scheduleType === 'later' && (
                <Field label="Select Future Date & Time" htmlFor="schedule-time">
                  <Input
                    id="schedule-time"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </Field>
              )}

              <div className="p-4 rounded-xl border bg-muted/40 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
                  <CheckCircle className="w-4 h-4 text-success" />
                  <span>Ready to Launch Summary</span>
                </div>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li><strong>Campaign:</strong> {name}</li>
                  <li><strong>Template:</strong> {selectedTemplate?.name} ({selectedTemplate?.language})</li>
                  <li><strong>Target Audience:</strong> {previewMutation.data?.eligibleCount ?? 0} eligible recipients</li>
                  <li><strong>Timing:</strong> {scheduleType === 'now' ? 'Immediate' : scheduledAt || 'Scheduled'}</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
