'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { API_URL, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';
import { useTerms } from '@/lib/pack';

interface Retention { settings: { webhookPayloadDays: number; softDeletedLeadDays: number; closedConversationDays: number | null; auditLogDays: number | null; automationDryRunDays: number; automationRunDays: number; automationVersionDays: number }; minDays: number; defaults: { webhookPayloadDays: number; softDeletedLeadDays: number; automationDryRunDays: number; automationRunDays: number; automationVersionDays: number } }
interface ExportRow { id: string; status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED'; sizeBytes: number | null; error: string | null; createdAt: string; expiresAt: string | null }
interface DeletionState { pending: boolean; requestedAt: string | null; purgeAfter: string | null; coolingOffDays: number }
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function RetentionCard() {
  const terms = useTerms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['retention'], queryFn: () => api<Retention>('/privacy/retention') });
  const [form, setForm] = useState<{ webhook: string; leads: string; convos: string; audit: string; dry: string; runs: string; versions: string } | null>(null);
  const v = form ?? (q.data ? { webhook: String(q.data.settings.webhookPayloadDays), leads: String(q.data.settings.softDeletedLeadDays), convos: q.data.settings.closedConversationDays?.toString() ?? '', audit: q.data.settings.auditLogDays?.toString() ?? '', dry: String(q.data.settings.automationDryRunDays), runs: String(q.data.settings.automationRunDays), versions: String(q.data.settings.automationVersionDays) } : null);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  // The server enforces the same bounds (shortest period from the platform setting, at most 10 years); checking here gives an inline message.
  const minDays = q.data?.minDays ?? 1;
  const dayError = (s: string): string | undefined => { const n = Number(s); return s.trim() !== '' && Number.isInteger(n) && n >= minDays && n <= 3650 ? undefined : `Enter a whole number of days from ${minDays} to 3650`; };
  const autoErrors = v ? { dry: dayError(v.dry), runs: dayError(v.runs), versions: dayError(v.versions) } : { dry: undefined, runs: undefined, versions: undefined };
  const hasError = Boolean(autoErrors.dry || autoErrors.runs || autoErrors.versions);
  const save = useMutation({
    mutationFn: () => api('/privacy/retention', { method: 'PUT', body: { webhookPayloadDays: Number(v?.webhook), softDeletedLeadDays: Number(v?.leads), closedConversationDays: num(v?.convos ?? ''), auditLogDays: num(v?.audit ?? ''), automationDryRunDays: Number(v?.dry), automationRunDays: Number(v?.runs), automationVersionDays: Number(v?.versions) } }),
    onSuccess: async () => { toast.success('Retention saved'); setForm(null); await qc.invalidateQueries({ queryKey: ['retention'] }); },
    onError: (e) => handleApiError(e),
  });
  const preview = useMutation({ mutationFn: () => api<Record<string, number>>('/privacy/retention/preview', { method: 'POST', body: {} }), onError: (e) => handleApiError(e) });
  if (!q.data || !v) return null;
  const set = (k: keyof typeof v, val: string) => setForm({ ...v, [k]: val });
  return (
    <Card>
      <CardHeader><CardTitle>Data retention</CardTitle></CardHeader>
      <CardBody>
        <p className="text-helper mb-3">Old data is purged automatically once a day. Leave a field empty to keep that data forever. Shortest allowed period: {q.data.minDays} days.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Raw WhatsApp webhook payloads (days)" htmlFor="ret-webhook" hint="Technical copies of provider messages; the conversation itself is not affected"><Input id="ret-webhook" inputMode="numeric" value={v.webhook} onChange={(e) => set('webhook', e.target.value)} /></Field>
          <Field label={`Deleted ${terms.leads}, until permanently erased (days)`} htmlFor="ret-leads" hint={`${terms.Leads} you delete stay recoverable for this long`}><Input id="ret-leads" inputMode="numeric" value={v.leads} onChange={(e) => set('leads', e.target.value)} /></Field>
          <Field label="Closed conversations (days after closing)" htmlFor="ret-convos" hint="Empty = keep"><Input id="ret-convos" inputMode="numeric" value={v.convos} onChange={(e) => set('convos', e.target.value)} /></Field>
          <Field label="Audit log (days)" htmlFor="ret-audit" hint="Empty = keep. Records of privacy actions are never aged out"><Input id="ret-audit" inputMode="numeric" value={v.audit} onChange={(e) => set('audit', e.target.value)} /></Field>
        </div>
        <h3 className="mt-6 text-[13px] font-semibold">Automation history</h3>
        <p className="text-helper mb-3">Cleaned up once a day. Automations that are queued, running or waiting are never deleted, and neither is the live version of an automation or any version a remaining run still points to.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Test runs (days)" htmlFor="ret-auto-dry" error={autoErrors.dry} hint={`Runs from "Test" on an automation. Default ${q.data.defaults.automationDryRunDays} days`}><Input id="ret-auto-dry" inputMode="numeric" value={v.dry} onChange={(e) => set('dry', e.target.value)} /></Field>
          <Field label="Finished runs (days)" htmlFor="ret-auto-runs" error={autoErrors.runs} hint={`Succeeded, failed and skipped runs in the run history. Default ${q.data.defaults.automationRunDays} days`}><Input id="ret-auto-runs" inputMode="numeric" value={v.runs} onChange={(e) => set('runs', e.target.value)} /></Field>
          <Field label="Old automation versions (days)" htmlFor="ret-auto-versions" error={autoErrors.versions} hint={`Earlier saved copies of an automation that no run uses any more. Default ${q.data.defaults.automationVersionDays} days`}><Input id="ret-auto-versions" inputMode="numeric" value={v.versions} onChange={(e) => set('versions', e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={save.isPending} disabled={!form || hasError} onClick={() => save.mutate()}>Save retention</Button>
          <Button loading={preview.isPending} onClick={() => preview.mutate()}>Preview what would be deleted</Button>
          {preview.data ? <span className="text-helper" role="status">{Object.values(preview.data).every((x) => x === 0) ? 'Nothing is due for deletion right now.' : `Due now: ${Object.entries(preview.data).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ')}`}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}

function ExportCard() {
  const terms = useTerms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exports'], queryFn: () => api<ExportRow[]>('/privacy/exports'), refetchInterval: (query) => (query.state.data?.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING') ? 4000 : false) });
  const request = useMutation({ mutationFn: () => api('/privacy/exports', { method: 'POST', body: {} }), onSuccess: async () => { toast.success('Export started. We will notify you when it is ready.'); await qc.invalidateQueries({ queryKey: ['exports'] }); }, onError: (e) => handleApiError(e) });
  const active = q.data?.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING');
  return (
    <Card>
      <CardHeader><CardTitle>Export your workspace data</CardTitle></CardHeader>
      <CardBody>
        <p className="text-helper mb-3">A single file (JSON, compressed) with your {terms.leads}, conversations, appointments, notes, consents, automations, settings and invoices. Passwords, access tokens and integration secrets are never included. Downloads stay available for 7 days.</p>
        <Button variant="primary" loading={request.isPending} disabled={active} onClick={() => request.mutate()}>{active ? 'Preparing export…' : 'Request export'}</Button>
        {q.data && q.data.length > 0 ? (
          <ul className="mt-4 divide-y divide-border text-[13px]">
            {q.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                <span>{fmt(e.createdAt)}</span>
                <Badge tone={e.status === 'READY' ? 'success' : e.status === 'FAILED' ? 'danger' : undefined}>{e.status === 'READY' ? 'Ready' : e.status === 'FAILED' ? 'Failed' : e.status === 'EXPIRED' ? 'Expired' : 'Preparing'}</Badge>
                {e.status === 'READY' ? <><span className="text-muted-foreground">{e.sizeBytes ? `${(e.sizeBytes / 1024).toFixed(0)} KB` : ''} · expires {fmt(e.expiresAt)}</span><Button size="sm" asChild><a href={`${API_URL}/privacy/exports/${e.id}/download`}><Download className="h-3.5 w-3.5" aria-hidden />Download</a></Button></> : null}
                {e.status === 'FAILED' ? <span className="text-danger">{e.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

const deleteWorkspaceSchema = z
  .object({
    reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
    confirm: z.string(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((val) => val.confirm === 'DELETE WORKSPACE', {
    message: 'Type DELETE WORKSPACE to confirm',
    path: ['confirm'],
  });

type DeleteWorkspaceFormValues = z.infer<typeof deleteWorkspaceSchema>;

function DeleteWorkspaceDrawer({
  open,
  onOpenChange,
  coolingOffDays,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  coolingOffDays: number;
  onSuccess: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DeleteWorkspaceFormValues>({
    resolver: zodResolver(deleteWorkspaceSchema),
    defaultValues: { reason: '', confirm: '', password: '' },
  });

  async function onSubmit(data: DeleteWorkspaceFormValues) {
    try {
      await api<DeletionState>('/privacy/workspace/deletion', {
        method: 'POST',
        body: { reason: data.reason, confirm: 'DELETE WORKSPACE', password: data.password },
      });
      toast.success('Deletion scheduled. The workspace is now read-only.');
      reset();
      onSuccess();
    } catch (e) {
      handleApiError(e, setError);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent
        title="Delete this workspace?"
        description={`The workspace becomes read-only now and is permanently deleted in ${coolingOffDays} days.`}
      >
        <form className="flex flex-1 flex-col justify-between" noValidate onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-3.5">
            <FormErrorAlert errors={errors} />
            <Field label="Why are you deleting it?" htmlFor="del-reason" error={errors.reason?.message}>
              <Input id="del-reason" autoFocus placeholder="Reason (min 5 chars)" {...register('reason')} />
            </Field>
            <Field label="Type DELETE WORKSPACE to confirm" htmlFor="del-confirm" error={errors.confirm?.message}>
              <Input id="del-confirm" autoComplete="off" placeholder="DELETE WORKSPACE" {...register('confirm')} />
            </Field>
            <Field label="Your password" htmlFor="del-password" error={errors.password?.message}>
              <Input id="del-password" type="password" autoComplete="current-password" {...register('password')} />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" onClick={() => { onOpenChange(false); reset(); }}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={isSubmitting}>
              Schedule deletion
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCard() {
  const terms = useTerms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['deletion'], queryFn: () => api<DeletionState>('/privacy/workspace/deletion') });
  const [open, setOpen] = useState(false);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['deletion'] });
    await qc.invalidateQueries({ queryKey: ['billing-summary'] });
  };
  const cancel = useMutation({
    mutationFn: () => api('/privacy/workspace/deletion/cancel', { method: 'POST', body: {} }),
    onSuccess: async () => {
      toast.success('Deletion cancelled');
      await refresh();
    },
    onError: (e) => handleApiError(e),
  });
  if (!q.data) return null;
  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle>Delete this workspace</CardTitle>
        {q.data.pending ? <Badge tone="danger">Scheduled</Badge> : null}
      </CardHeader>
      <CardBody>
        {q.data.pending ? (
          <>
            <p className="mb-3 text-[13px]">
              Everything in this workspace will be permanently deleted on <strong>{fmt(q.data.purgeAfter)}</strong>. Until then it is read-only. You can still export your data, and you can cancel the deletion at any time before then.
            </p>
            <Button loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel deletion
            </Button>
          </>
        ) : (
          <>
            <p className="text-helper mb-3">
              Permanently deletes all {terms.leads}, conversations, files and team accounts that belong only to this workspace. After a {q.data.coolingOffDays}-day cooling-off period during which the workspace is read-only, this cannot be undone. Invoices are kept as required for tax records. Export your data first.
            </p>
            <Button variant="danger" onClick={() => setOpen(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />Delete workspace…
            </Button>
          </>
        )}
        <DeleteWorkspaceDrawer
          open={open}
          onOpenChange={setOpen}
          coolingOffDays={q.data.coolingOffDays}
          onSuccess={() => {
            setOpen(false);
            void refresh();
          }}
        />
      </CardBody>
    </Card>
  );
}

/** Settings cards for the data lifecycle. Retention needs `settings:manage`; export and deletion are owner-only (the API enforces it too). */
export function WorkspacePrivacy() {
  const { can, activeWorkspace } = useAuth();
  const owner = activeWorkspace?.roleKey === 'owner';
  if (!can('settings:manage')) return null;
  return <><RetentionCard />{owner ? <><ExportCard /><DeleteCard /></> : null}</>;
}
