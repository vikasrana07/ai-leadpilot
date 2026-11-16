'use client';

import { TIMELINES } from '@leadpilot/validation';
import type { LeadDetailDto, LeadDto } from '@leadpilot/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Mail, MapPin, Pencil, Phone, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ActivityTimeline, type ActivityItem } from '@/components/crm/activity-timeline';
import { StageBadge, TemperatureBadge } from '@/components/crm/lead-badges';
import { ScoreCard } from '@/components/ai/score-card';
import { MergeDialog } from '@/components/crm/merge-dialog';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { LeadPrivacyMenu } from '@/components/privacy/lead-privacy';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useLeadMeta, useMembers, useStages } from '@/lib/crm';
import { formatBudget, TIMELINE_LABELS, timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface Note { id: string; body: string; author: string; createdAt: string }

function EditDialog({ lead, open, onOpenChange }: { lead: LeadDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const meta = useLeadMeta();
  const [f, setF] = useState({ name: lead.name, phone: lead.phone ?? '', email: lead.email ?? '', budgetMin: lead.budgetMin?.toString() ?? '', budgetMax: lead.budgetMax?.toString() ?? '', location: lead.location ?? '', propertyType: lead.propertyType ?? '', requirements: lead.requirements ?? '', buyingTimeline: lead.buyingTimeline, nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 16) : '' });
  const [cf, setCf] = useState<Record<string, string | number | boolean>>(lead.customFields);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  async function save() {
    setBusy(true); setErrors({});
    try {
      await api(`/leads/${lead.id}`, { method: 'PATCH', body: { name: f.name, phone: f.phone || null, email: f.email || null, budgetMin: num(f.budgetMin), budgetMax: num(f.budgetMax), location: f.location || null, propertyType: f.propertyType || null, requirements: f.requirements || null, buyingTimeline: f.buyingTimeline, nextFollowUpAt: f.nextFollowUpAt ? new Date(f.nextFollowUpAt).toISOString() : null, customFields: cf } });
      toast.success('Lead updated');
      await qc.invalidateQueries({ queryKey: ['leads'] }); await qc.invalidateQueries({ queryKey: ['pipeline'] });
      onOpenChange(false);
    } catch (e) { if (e instanceof ApiError && e.details) setErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message]))); else handleApiError(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit lead" className="max-w-xl">
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <Field label="Name" htmlFor="e-name" error={errors.name} className="sm:col-span-2"><Input id="e-name" value={f.name} onChange={set('name')} /></Field>
          <Field label="Phone" htmlFor="e-phone" error={errors.phone}><Input id="e-phone" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email" htmlFor="e-email" error={errors.email}><Input id="e-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Budget min (₹)" htmlFor="e-bmin" error={errors.budgetMin}><Input id="e-bmin" inputMode="numeric" value={f.budgetMin} onChange={set('budgetMin')} /></Field>
          <Field label="Budget max (₹)" htmlFor="e-bmax"><Input id="e-bmax" inputMode="numeric" value={f.budgetMax} onChange={set('budgetMax')} /></Field>
          <Field label="Location" htmlFor="e-loc"><Input id="e-loc" value={f.location} onChange={set('location')} /></Field>
          <Field label="Property type" htmlFor="e-type"><Input id="e-type" value={f.propertyType} onChange={set('propertyType')} /></Field>
          <Field label="Buying timeline" htmlFor="e-tl"><Select id="e-tl" value={f.buyingTimeline} onChange={set('buyingTimeline')}>{TIMELINES.map((t) => <option key={t} value={t}>{TIMELINE_LABELS[t]}</option>)}</Select></Field>
          <Field label="Next follow-up" htmlFor="e-fu" className="sm:col-span-2"><Input id="e-fu" type="datetime-local" value={f.nextFollowUpAt} onChange={set('nextFollowUpAt')} /></Field>
          <Field label="Requirements" htmlFor="e-req" className="sm:col-span-2"><Textarea id="e-req" value={f.requirements} onChange={set('requirements')} /></Field>
          {meta.data?.customFields.map((d) => (
            <Field key={d.key} label={d.label} htmlFor={`cf-${d.key}`} error={errors[`customFields.${d.key}`]}>
              {d.type === 'select' ? <Select id={`cf-${d.key}`} value={String(cf[d.key] ?? '')} onChange={(e) => setCf((s) => ({ ...s, [d.key]: e.target.value }))}><option value="">—</option>{d.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                : d.type === 'boolean' ? <Select id={`cf-${d.key}`} value={cf[d.key] === undefined ? '' : String(cf[d.key])} onChange={(e) => setCf((s) => ({ ...s, [d.key]: e.target.value === 'true' }))}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></Select>
                : <Input id={`cf-${d.key}`} type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'} value={String(cf[d.key] ?? '')} onChange={(e) => setCf((s) => ({ ...s, [d.key]: d.type === 'number' ? Number(e.target.value) : e.target.value }))} />}
            </Field>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save changes</Button></div>
      </DialogContent>
    </Dialog>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const stages = useStages(); const members = useMembers();
  const [tab, setTab] = useState<'activity' | 'notes'>('activity');
  const [editOpen, setEditOpen] = useState(false); const [mergeOpen, setMergeOpen] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false);
  const [lostFor, setLostFor] = useState<string | null>(null); const [lostReason, setLostReason] = useState(''); const [lostNote, setLostNote] = useState('');
  const [noteText, setNoteText] = useState(''); const [tagText, setTagText] = useState('');

  const lead = useQuery({ queryKey: ['leads', 'detail', id], queryFn: () => api<LeadDetailDto>(`/leads/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const timeline = useQuery({ queryKey: ['leads', 'activity', id], queryFn: () => api<ActivityItem[]>(`/leads/${id}/activity`) });
  const notes = useQuery({ queryKey: ['leads', 'notes', id], queryFn: () => api<Note[]>(`/leads/${id}/notes`) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['leads'] }), qc.invalidateQueries({ queryKey: ['pipeline'] }), qc.invalidateQueries({ queryKey: ['analytics'] })]);
  useEffect(() => { if (lead.data) document.title = `${lead.data.name} · LeadPilot`; }, [lead.data]);

  const move = useMutation({ mutationFn: (b: { stageId: string; lostReasonId?: string; lostNote?: string }) => api(`/leads/${id}/stage`, { method: 'POST', body: b }), onSuccess: async () => { toast.success('Stage updated'); setLostFor(null); setLostReason(''); setLostNote(''); await refresh(); }, onError: (e) => handleApiError(e) });
  const assign = useMutation({ mutationFn: (m: string) => api(`/leads/${id}`, { method: 'PATCH', body: { assignedMembershipId: m || null } }), onSuccess: async () => { toast.success('Assignment updated'); await refresh(); }, onError: (e) => handleApiError(e) });
  const addNote = useMutation({ mutationFn: (body: string) => api(`/leads/${id}/notes`, { method: 'POST', body: { body } }), onSuccess: async () => { setNoteText(''); await refresh(); }, onError: (e) => handleApiError(e) });
  const setTags = useMutation({ mutationFn: (names: string[]) => api(`/leads/${id}/tags`, { method: 'PUT', body: { names } }), onSuccess: async () => { setTagText(''); await refresh(); }, onError: (e) => handleApiError(e) });

  if (lead.isPending) return <><PageHeader title="Lead" /><div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div></>;
  if (lead.isError) return <Card><EmptyState icon={Pencil} title="Lead not found" description="It may have been deleted, merged into another lead, or assigned to someone else." action={<Button asChild><Link href="/leads">Back to leads</Link></Button>} /></Card>;
  const l = lead.data;
  const openStages = stages.data?.stages ?? [];
  const tagNames = l.tags.map((t) => t.name);

  return (
    <>
      <PageHeader title={l.name} breadcrumbs={[{ label: 'Leads', href: '/leads' }, { label: l.name }]} actions={<>
        {can('lead:write:all') ? <Button onClick={() => setMergeOpen(true)}><GitMerge className="h-4 w-4" aria-hidden />Merge duplicates</Button> : null}
        {l.canWrite ? <Button onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" aria-hidden />Edit</Button> : null}
        <LeadPrivacyMenu leadId={id} leadName={l.name} />
        {can('lead:delete') ? <Button variant="ghost" size="icon" aria-label="Delete lead" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" /></Button> : null}
      </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StageBadge name={l.stage.name} kind={l.stage.kind} /><TemperatureBadge value={l.temperature} />
        {l.score !== null ? <Badge tone="primary" className="num">Score {l.score}</Badge> : <Badge>Not scored yet</Badge>}
        {l.source ? <Badge>{l.source.name}</Badge> : null}
        {l.nextFollowUpAt ? <Badge tone={new Date(l.nextFollowUpAt) < new Date() && l.stage.kind === 'OPEN' ? 'danger' : 'neutral'}>Follow-up {timeAgo(l.nextFollowUpAt)}</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <div role="tablist" aria-label="Lead sections" className="flex gap-1 border-b border-border px-3">
            {([['activity', 'Activity'], ['notes', `Notes${notes.data?.length ? ` (${notes.data.length})` : ''}`]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('relative px-3 py-3 text-[13px] font-medium', tab === k ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}{tab === k ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}</button>
            ))}
          </div>
          <CardBody>
            {tab === 'activity' ? (timeline.isPending ? <Skeleton className="h-40" /> : <ActivityTimeline items={timeline.data ?? []} />) : (
              <div className="space-y-4">
                {l.canWrite ? (
                  <form onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) addNote.mutate(noteText.trim()); }} className="space-y-2">
                    <Textarea aria-label="Add a note" placeholder="Add a note about this lead…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                    <div className="flex justify-end"><Button type="submit" variant="primary" size="sm" loading={addNote.isPending} disabled={!noteText.trim()}>Add note</Button></div>
                  </form>
                ) : null}
                {notes.data?.length ? <ul className="space-y-3">{notes.data.map((n) => <li key={n.id} className="rounded-lg border border-border p-3"><p className="whitespace-pre-wrap text-[13px]">{n.body}</p><p className="text-helper mt-1.5">{n.author} · {timeAgo(n.createdAt)}</p></li>)}</ul> : <p className="text-helper py-4 text-center">No notes yet.</p>}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardBody className="space-y-2 text-[13px]">
              <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{l.phone ? <a className="hover:text-primary" href={`tel:${l.phone}`}>{l.phone}</a> : '—'}</p>
              <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{l.email ? <a className="truncate hover:text-primary" href={`mailto:${l.email}`}>{l.email}</a> : '—'}</p>
              <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{l.location ?? '—'}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Pipeline</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              <Field label="Stage" htmlFor="stage-sel">
                <Select id="stage-sel" value={l.stage.id} disabled={!l.canWrite || move.isPending} onChange={(e) => { const s = openStages.find((x) => x.id === e.target.value); if (!s) return; if (s.kind === 'LOST') setLostFor(s.id); else move.mutate({ stageId: s.id }); }}>
                  {openStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Assigned to" htmlFor="assign-sel">
                {can('lead:assign') ? <Select id="assign-sel" value={l.assignedMembershipId ?? ''} onChange={(e) => assign.mutate(e.target.value)}><option value="">Unassigned</option>{members.data?.filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select>
                  : <p className="flex items-center gap-2 text-[13px]">{l.assignee ? <><Avatar name={l.assignee.name} size={22} />{l.assignee.name}</> : 'Unassigned'}</p>}
              </Field>
            </CardBody>
          </Card>
          <ScoreCard leadId={l.id} />
          <Card>
            <CardHeader><CardTitle>Qualification</CardTitle></CardHeader>
            <CardBody>
              <dl className="space-y-2.5 text-[13px]">
                {[['Budget', formatBudget(l.budgetMin, l.budgetMax)], ['Property', l.propertyType ?? '—'], ['Timeline', TIMELINE_LABELS[l.buyingTimeline]], ['Last contacted', l.lastContactedAt ? timeAgo(l.lastContactedAt) : 'never']].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="num text-right font-medium">{v}</dd></div>)}
                {Object.entries(l.customFields).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt><dd className="text-right font-medium">{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd></div>)}
              </dl>
              {l.requirements ? <p className="mt-3 border-t border-border pt-3 text-[13px] text-muted-foreground">{l.requirements}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Tags</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-1.5">{l.tags.length ? l.tags.map((t) => <Badge key={t.id}>{t.name}{l.canWrite ? <button aria-label={`Remove tag ${t.name}`} className="ml-0.5 rounded hover:text-foreground" onClick={() => setTags.mutate(tagNames.filter((n) => n !== t.name))}><X className="h-3 w-3" /></button> : null}</Badge>) : <span className="text-helper">No tags</span>}</div>
              {l.canWrite ? <form onSubmit={(e) => { e.preventDefault(); const n = tagText.trim(); if (n && !tagNames.includes(n)) setTags.mutate([...tagNames, n]); }} className="flex gap-2"><Input aria-label="New tag" placeholder="Add tag" value={tagText} onChange={(e) => setTagText(e.target.value)} /><Button type="submit" size="sm" disabled={!tagText.trim()}>Add</Button></form> : null}
            </CardBody>
          </Card>
          {l.mergedLeads.length ? <p className="text-helper px-1">Merged from: {l.mergedLeads.map((m) => m.name).join(', ')}</p> : null}
        </div>
      </div>

      <EditDialog key={l.updatedAt} lead={l} open={editOpen} onOpenChange={setEditOpen} />
      <MergeDialog open={mergeOpen} onOpenChange={setMergeOpen} lead={l} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} danger title="Delete this lead?" description="It disappears from lists and reports. This is recorded in the audit log." confirmLabel="Delete lead" onConfirm={async () => { try { await api(`/leads/${id}`, { method: 'DELETE' }); toast.success('Lead deleted'); await refresh(); router.replace('/leads'); } catch (e) { handleApiError(e); throw e; } }} />
      <Dialog open={lostFor !== null} onOpenChange={(o) => { if (!o) setLostFor(null); }}>
        <DialogContent title="Why was this lead lost?" description="This helps you see where deals fall through.">
          <div className="space-y-3">
            <Field label="Reason" htmlFor="lost-reason"><Select id="lost-reason" value={lostReason} onChange={(e) => setLostReason(e.target.value)}><option value="">Choose a reason…</option>{stages.data?.lostReasons.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            <Field label="Note (optional)" htmlFor="lost-note"><Textarea id="lost-note" value={lostNote} onChange={(e) => setLostNote(e.target.value)} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setLostFor(null)}>Cancel</Button><Button variant="danger" disabled={!lostReason} loading={move.isPending} onClick={() => lostFor && move.mutate({ stageId: lostFor, lostReasonId: lostReason, ...(lostNote ? { lostNote } : {}) })}>Mark as lost</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
