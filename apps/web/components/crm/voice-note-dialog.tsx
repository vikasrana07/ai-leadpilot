'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Mic, Square, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, apiUpload } from '@/lib/api';
import { handleApiError } from '@/lib/forms';

interface ExtractionResult {
  transcript: string;
  language: string;
  extraction: {
    note: string;
    updates: {
      budgetMin?: number;
      budgetMax?: number;
      location?: string;
      propertyType?: string;
      buyingTimeline?: string;
    };
    suggestedTask?: {
      title: string;
      dueAt: string;
    };
  };
}

export function VoiceNoteDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manualText, setManualText] = useState('');
  const [result, setResult] = useState<ExtractionResult | null>(null);

  const [note, setNote] = useState('');
  const [location, setLocation] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');

  function hydrate(res: ExtractionResult) {
    setResult(res);
    setNote(res.extraction.note);
    setLocation(res.extraction.updates.location ?? '');
    setPropertyType(res.extraction.updates.propertyType ?? '');
    setBudgetMax(res.extraction.updates.budgetMax ? String(res.extraction.updates.budgetMax) : '');
    setTaskTitle(res.extraction.suggestedTask?.title ?? '');
    setTaskDueAt(res.extraction.suggestedTask?.dueAt ?? '');
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setBusy(true);
        try {
          const fd = new FormData();
          fd.append('file', blob, 'voice-note.webm');
          const res = await apiUpload<ExtractionResult>(`/leads/${leadId}/voice-note`, fd);
          hydrate(res);
        } catch (err) {
          handleApiError(err);
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error('Microphone access unavailable. You can type or paste your voice memo below.');
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function extractFromText() {
    if (!manualText.trim()) return;
    setBusy(true);
    try {
      const res = await api<ExtractionResult>(`/leads/${leadId}/voice-note`, {
        method: 'POST',
        body: { transcript: manualText.trim() },
      });
      hydrate(res);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  }

  const apply = useMutation({
    mutationFn: () =>
      api(`/leads/${leadId}/voice-note/apply`, {
        method: 'POST',
        body: {
          note: note.trim(),
          updates: {
            ...(location.trim() ? { location: location.trim() } : {}),
            ...(propertyType.trim() ? { propertyType: propertyType.trim() } : {}),
            ...(budgetMax.trim() && Number(budgetMax) > 0 ? { budgetMax: Number(budgetMax) } : {}),
            ...(result?.extraction.updates.buyingTimeline
              ? { buyingTimeline: result.extraction.updates.buyingTimeline }
              : {}),
          },
          ...(taskTitle.trim()
            ? { task: { title: taskTitle.trim(), ...(taskDueAt ? { dueAt: taskDueAt } : {}) } }
            : {}),
        },
      }),
    onSuccess: async () => {
      toast.success('Voice update applied to lead');
      setResult(null);
      setManualText('');
      await qc.invalidateQueries({ queryKey: ['leads', leadId] });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    },
    onError: (e) => handleApiError(e),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Voice-to-CRM update"
        description="Record a quick 15-second voice memo. LeadPilot extracts fields, notes, and follow-up tasks automatically."
        size="md"
      >
        {!result ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface p-6 text-center">
              <Button
                type="button"
                variant={recording ? 'danger' : 'primary'}
                loading={busy}
                onClick={recording ? stopRecording : () => void startRecording()}
              >
                {recording ? (
                  <>
                    <Square className="h-4 w-4" aria-hidden />
                    Stop &amp; extract
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" aria-hidden />
                    Start recording
                  </>
                )}
              </Button>
              <p className="text-helper">
                Example: &ldquo;Met Rahul at Wakad, liked 3 BHK, budget 85 lakh, follow up tomorrow.&rdquo;
              </p>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <Field label="Or paste/dictate memo text" htmlFor="vn-text">
                <Textarea
                  id="vn-text"
                  placeholder="Met customer at Baner, looking for 2 BHK around 80 lakh, follow up tomorrow…"
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="button" variant="secondary" loading={busy} disabled={!manualText.trim()} onClick={() => void extractFromText()}>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  Extract fields
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="primary">Transcribed ({result.language})</Badge>
              {location ? <Badge tone="success">Location: {location}</Badge> : null}
              {propertyType ? <Badge tone="success">Type: {propertyType}</Badge> : null}
              {budgetMax ? <Badge tone="success">Budget: ₹{Number(budgetMax).toLocaleString('en-IN')}</Badge> : null}
            </div>
            <Field label="Note to log" htmlFor="vn-note">
              <Textarea id="vn-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Location" htmlFor="vn-loc">
                <Input id="vn-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
              </Field>
              <Field label="Interest / Type" htmlFor="vn-type">
                <Input id="vn-type" value={propertyType} onChange={(e) => setPropertyType(e.target.value)} />
              </Field>
              <Field label="Max Budget (₹)" htmlFor="vn-budget">
                <Input id="vn-budget" type="number" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
              </Field>
            </div>
            <Field label="Follow-up task (optional)" htmlFor="vn-task">
              <Input id="vn-task" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Leave blank to skip task creation" />
            </Field>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" onClick={() => setResult(null)}>Re-record</Button>
              <Button type="button" variant="primary" loading={apply.isPending} disabled={!note.trim()} onClick={() => apply.mutate()}>
                <Check className="h-4 w-4" aria-hidden />
                Apply to lead
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
