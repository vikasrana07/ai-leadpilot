'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { API_URL, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

interface Retention { settings: { webhookPayloadDays: number; softDeletedLeadDays: number; closedConversationDays: number | null; auditLogDays: number | null }; minDays: number; defaults: { webhookPayloadDays: number; softDeletedLeadDays: number } }
interface ExportRow { id: string; status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED'; sizeBytes: number | null; error: string | null; createdAt: string; expiresAt: string | null }
interface DeletionState { pending: boolean; requestedAt: string | null; purgeAfter: string | null; coolingOffDays: number }
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function RetentionCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['retention'], queryFn: () => api<Retention>('/privacy/retention') });
  const [form, setForm] = useState<{ webhook: string; leads: string; convos: string; audit: string } | null>(null);
  const v = form ?? (q.data ? { webhook: String(q.data.settings.webhookPayloadDays), leads: String(q.data.settings.softDeletedLeadDays), convos: q.data.settings.closedConversationDays?.toString() ?? '', audit: q.data.settings.auditLogDays?.toString() ?? '' } : null);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const save = useMutation({
    mutationFn: () => api('/privacy/retention', { method: 'PUT', body: { webhookPayloadDays: Number(v?.webhook), softDeletedLeadDays: Number(v?.leads), closedConversationDays: num(v?.convos ?? ''), auditLogDays: num(v?.audit ?? '') } }),
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
          <Field label="Deleted leads, until permanently erased (days)" htmlFor="ret-leads" hint="Leads you delete stay recoverable for this long"><Input id="ret-leads" inputMode="numeric" value={v.leads} onChange={(e) => set('leads', e.target.value)} /></Field>
          <Field label="Closed conversations (days after closing)" htmlFor="ret-convos" hint="Empty = keep"><Input id="ret-convos" inputMode="numeric" value={v.convos} onChange={(e) => set('convos', e.target.value)} /></Field>
          <Field label="Audit log (days)" htmlFor="ret-audit" hint="Empty = keep. Records of privacy actions are never aged out"><Input id="ret-audit" inputMode="numeric" value={v.audit} onChange={(e) => set('audit', e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={save.isPending} disabled={!form} onClick={() => save.mutate()}>Save retention</Button>
          <Button loading={preview.isPending} onClick={() => preview.mutate()}>Preview what would be deleted</Button>
          {preview.data ? <span className="text-helper" role="status">{Object.values(preview.data).every((x) => x === 0) ? 'Nothing is due for deletion right now.' : `Due now: ${Object.entries(preview.data).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ')}`}</span> : null}
        </div>
      </CardBody>
    </Card>
  );
}

function ExportCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exports'], queryFn: () => api<ExportRow[]>('/privacy/exports'), refetchInterval: (query) => (query.state.data?.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING') ? 4000 : false) });
  const request = useMutation({ mutationFn: () => api('/privacy/exports', { method: 'POST', body: {} }), onSuccess: async () => { toast.success('Export started. We will notify you when it is ready.'); await qc.invalidateQueries({ queryKey: ['exports'] }); }, onError: (e) => handleApiError(e) });
  const active = q.data?.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING');
  return (
    <Card>
      <CardHeader><CardTitle>Export your workspace data</CardTitle></CardHeader>
      <CardBody>
        <p className="text-helper mb-3">A single file (JSON, compressed) with your leads, conversations, appointments, notes, consents, automations, settings and invoices. Passwords, access tokens and integration secrets are never included. Downloads stay available for 7 days.</p>
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

function DeleteCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['deletion'], queryFn: () => api<DeletionState>('/privacy/workspace/deletion') });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(''); const [confirm, setConfirm] = useState(''); const [password, setPassword] = useState('');
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['deletion'] }); await qc.invalidateQueries({ queryKey: ['billing-summary'] }); };
  const request = useMutation({ mutationFn: () => api<DeletionState>('/privacy/workspace/deletion', { method: 'POST', body: { reason, confirm: 'DELETE WORKSPACE', password } }), onSuccess: async () => { setOpen(false); setPassword(''); toast.success('Deletion scheduled. The workspace is now read-only.'); await refresh(); }, onError: (e) => handleApiError(e) });
  const cancel = useMutation({ mutationFn: () => api('/privacy/workspace/deletion/cancel', { method: 'POST', body: {} }), onSuccess: async () => { toast.success('Deletion cancelled'); await refresh(); }, onError: (e) => handleApiError(e) });
  if (!q.data) return null;
  return (
    <Card className="border-danger/40">
      <CardHeader><CardTitle>Delete this workspace</CardTitle>{q.data.pending ? <Badge tone="danger">Scheduled</Badge> : null}</CardHeader>
      <CardBody>
        {q.data.pending ? (
          <>
            <p className="mb-3 text-[13px]">Everything in this workspace will be permanently deleted on <strong>{fmt(q.data.purgeAfter)}</strong>. Until then it is read-only. You can still export your data, and you can cancel the deletion at any time before then.</p>
            <Button loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel deletion</Button>
          </>
        ) : (
          <>
            <p className="text-helper mb-3">Permanently deletes all leads, conversations, files and team accounts that belong only to this workspace. After a {q.data.coolingOffDays}-day cooling-off period during which the workspace is read-only, this cannot be undone. Invoices are kept as required for tax records. Export your data first.</p>
            <Button variant="danger" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" aria-hidden />Delete workspace…</Button>
          </>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title="Delete this workspace?" description={`The workspace becomes read-only now and is permanently deleted in ${q.data.coolingOffDays} days.`}>
            <div className="space-y-3">
              <Field label="Why are you deleting it?" htmlFor="del-reason"><Input id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <Field label="Type DELETE WORKSPACE to confirm" htmlFor="del-confirm"><Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
              <Field label="Your password" htmlFor="del-password"><Input id="del-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" loading={request.isPending} disabled={confirm !== 'DELETE WORKSPACE' || reason.trim().length < 5 || !password} onClick={() => request.mutate()}>Schedule deletion</Button></div>
          </DialogContent>
        </Dialog>
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
