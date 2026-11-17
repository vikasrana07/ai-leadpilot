'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, List, Plus, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/use-debounce';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs, useMembers } from '@/lib/crm';
import { usePack, visitWords } from '@/lib/pack';
import { handleApiError } from '@/lib/forms';
import { DAY_NAMES, fmtDay, fmtTime, localDate, minuteLabel, parseMinute, type Appointment, type AvailabilityView, type SlotsResponse } from '@/lib/ops';
import { cn } from '@/lib/cn';

const TONE = { PENDING: 'warning', CONFIRMED: 'success', COMPLETED: 'primary', CANCELLED: 'neutral', NO_SHOW: 'danger', RESCHEDULED: 'neutral' } as const;
const LABEL: Record<string, string> = { PENDING: 'Needs confirmation', CONFIRMED: 'Confirmed', COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show', RESCHEDULED: 'Rescheduled' };
const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (date: string) => { const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, dow === 0 ? -6 : 1 - dow); };

function SlotPicker({ leadId, membershipId, duration, value, onChange, excludeAppointment }: { leadId: string; membershipId: string; duration: number; value: string; onChange: (iso: string, membershipId: string) => void; excludeAppointment?: string }) {
  const [from, setFrom] = useState(() => localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
  const slots = useQuery({ queryKey: ['appointments', 'slots', from, duration, membershipId], queryFn: () => api<SlotsResponse>(`/appointments/slots${qs({ from, days: 7, durationMinutes: duration, membershipId: membershipId || undefined })}`) });
  void leadId; void excludeAppointment;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><p className="text-label">Available times</p>
        <div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="Earlier week" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Later week" onClick={() => setFrom(addDays(from, 7))}><ChevronRight className="h-4 w-4" /></Button></div></div>
      {slots.isPending ? <Skeleton className="h-32" /> : slots.isError ? <p className="text-helper !text-danger">Could not load times.</p> : (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-2">
          {slots.data.days.every((d) => d.slots.length === 0) ? <p className="text-helper p-2">No free times this week. Try the next week or change the agent.</p> : slots.data.days.filter((d) => d.slots.length).map((d) => (
            <div key={d.date}><p className="text-helper mb-1 font-medium">{fmtDay(d.slots[0]?.startsAt ?? `${d.date}T00:00:00Z`, slots.data.timezone)}</p>
              <div className="flex flex-wrap gap-1.5">{d.slots.map((s) => (
                <button key={s.startsAt} type="button" onClick={() => onChange(s.startsAt, membershipId || (s.membershipIds[0] ?? ''))} aria-pressed={value === s.startsAt} className={cn('num rounded-md border px-2 py-1 text-[12px] transition-colors', value === s.startsAt ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-border-strong hover:bg-muted')}>{fmtTime(s.startsAt, slots.data.timezone)}</button>))}</div></div>))}
        </div>)}
    </div>
  );
}

function BookDialog({ onClose, reschedule }: { onClose: () => void; reschedule?: Appointment }) {
  const vw = visitWords(usePack());
  const qc = useQueryClient(); const { can } = useAuth(); const members = useMembers();
  const [search, setSearch] = useState(''); const q = useDebounce(search, 250);
  const [lead, setLead] = useState<{ id: string; name: string } | null>(reschedule ? { id: reschedule.leadId, name: reschedule.leadName } : null);
  const leads = useQuery({ queryKey: ['leads', 'picker', q], enabled: !reschedule && !lead, queryFn: () => api<{ items: { id: string; name: string; phone: string | null }[] }>(`/leads${qs({ q, pageSize: 6 })}`) });
  const [agent, setAgent] = useState(reschedule?.membershipId ?? ''); const [duration, setDuration] = useState(reschedule ? Math.round((new Date(reschedule.endsAt).getTime() - new Date(reschedule.startsAt).getTime()) / 60000) : 60);
  const [startsAt, setStartsAt] = useState(''); const [notes, setNotes] = useState(reschedule?.notes ?? ''); const [location, setLocation] = useState(reschedule?.location ?? ''); const [busy, setBusy] = useState(false);
  const manager = can('appointment:read:all');
  async function save() {
    if (!lead || !startsAt) return;
    setBusy(true);
    try {
      if (reschedule) await api(`/appointments/${reschedule.id}/reschedule`, { method: 'POST', body: { startsAt, durationMinutes: duration, ...(agent && manager ? { membershipId: agent } : {}) } });
      else await api('/appointments', { method: 'POST', body: { leadId: lead.id, ...(agent ? { membershipId: agent } : {}), startsAt, durationMinutes: duration, notes: notes || null, location: location || null } });
      toast.success(reschedule ? `${vw.Visit} rescheduled` : `${vw.Visit} booked`); await qc.invalidateQueries({ queryKey: ['appointments'] }); onClose();
    } catch (e) { if (e instanceof ApiError && (e.code === 'slot_taken' || e.code === 'lead_busy')) { toast.error(e.message); await qc.invalidateQueries({ queryKey: ['appointments', 'slots'] }); setStartsAt(''); } else handleApiError(e); } finally { setBusy(false); }
  }
  const eligible = (members.data ?? []).filter((m) => m.status === 'ACTIVE');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={reschedule ? `Reschedule ${vw.visit}` : `Book ${vw.a}`} className="max-w-xl">
        <div className="grid max-h-[72vh] gap-3 overflow-y-auto pr-1">
          {reschedule ? <p className="text-[13px]">{reschedule.leadName} · now {fmtDay(reschedule.startsAt, 'Asia/Kolkata')}</p> : lead ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]"><span className="font-medium">{lead.name}</span><Button size="sm" variant="ghost" onClick={() => setLead(null)}>Change</Button></div>
          ) : (
            <Field label="Customer" htmlFor="b-lead"><Input id="b-lead" autoFocus placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="mt-1 divide-y divide-border rounded-md border border-border">{(leads.data?.items ?? []).map((l) => <button key={l.id} type="button" className="flex w-full justify-between px-3 py-2 text-left text-[13px] hover:bg-muted" onClick={() => setLead({ id: l.id, name: l.name })}><span>{l.name}</span><span className="text-helper">{l.phone}</span></button>)}{leads.data && leads.data.items.length === 0 ? <p className="text-helper px-3 py-2">No matching leads.</p> : null}</div></Field>)}
          {lead ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              {manager ? <Field label="Agent" htmlFor="b-agent"><Select id="b-agent" value={agent} onChange={(e) => { setAgent(e.target.value); setStartsAt(''); }}><option value="">Any free agent</option>{eligible.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select></Field> : null}
              <Field label="Length" htmlFor="b-dur"><Select id="b-dur" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setStartsAt(''); }}>{[30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} minutes</option>)}</Select></Field>
            </div>
            <SlotPicker leadId={lead.id} membershipId={agent} duration={duration} value={startsAt} onChange={(iso, m) => { setStartsAt(iso); if (!agent && m) setAgent(''); }} />
            {!reschedule ? <><Field label="Location" htmlFor="b-loc"><Input id="b-loc" placeholder="Site address or meeting link" value={location} onChange={(e) => setLocation(e.target.value)} /></Field><Field label="Notes" htmlFor="b-notes"><Textarea id="b-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></> : null}
          </> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!lead || !startsAt} loading={busy} onClick={() => void save()}>{reschedule ? `Move ${vw.visit}` : `Book ${vw.visit}`}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ id, tz, onClose, onReschedule }: { id: string; tz: string; onClose: () => void; onReschedule: (a: Appointment) => void }) {
  const vw = visitWords(usePack());
  const qc = useQueryClient(); const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['appointments', 'detail', id], queryFn: () => api<Appointment>(`/appointments/${id}`) });
  const act = useMutation({ mutationFn: (a: { path: string; body?: unknown }) => api<Appointment>(`/appointments/${id}/${a.path}`, { method: 'POST', body: a.body ?? {} }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['appointments'] }); toast.success('Updated'); }, onError: (e) => handleApiError(e) });
  const a = q.data; const active = a?.status === 'PENDING' || a?.status === 'CONFIRMED'; const [now] = useState(() => Date.now()); const started = a ? new Date(a.startsAt).getTime() <= now : false;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={a?.title ?? vw.Visit} className="max-w-lg">
        {!a ? <Skeleton className="h-40" /> : <div className="space-y-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge>{a.source === 'ai' ? <Badge tone="primary">Booked by AI</Badge> : null}</div>
          <p><Clock className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden />{fmtDay(a.startsAt, tz)}, {fmtTime(a.startsAt, tz)} – {fmtTime(a.endsAt, tz)}</p>
          <p><span className="text-muted-foreground">Customer:</span> {a.leadName}{a.leadPhone ? ` · ${a.leadPhone}` : ''}</p><p><span className="text-muted-foreground">Agent:</span> {a.agentName}</p>
          {a.location ? <p><span className="text-muted-foreground">Where:</span> {a.location}</p> : null}{a.notes ? <p className="whitespace-pre-wrap">{a.notes}</p> : null}{a.cancelledReason ? <p className="text-muted-foreground">Cancelled: {a.cancelledReason}</p> : null}
          {active ? <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {a.status === 'PENDING' ? <Button variant="primary" size="sm" loading={act.isPending} onClick={() => act.mutate({ path: 'confirm' })}>Confirm</Button> : null}
            <Button size="sm" onClick={() => onReschedule(a)}>Reschedule</Button>
            {started ? <><Button size="sm" onClick={() => act.mutate({ path: 'complete' })}>Mark completed</Button><Button size="sm" onClick={() => act.mutate({ path: 'no-show' })}>No-show</Button></> : null}
          </div> : null}
          {active ? <div className="flex gap-2"><Input aria-label="Cancellation reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="danger" onClick={() => act.mutate({ path: 'cancel', body: { reason: reason || undefined } })}>Cancel visit</Button></div> : null}
          {a.events?.length ? <div className="border-t border-border pt-3"><p className="text-label mb-1">History</p><ul className="space-y-1">{a.events.map((e) => <li key={e.id} className="text-helper">{new Date(e.createdAt).toLocaleString('en-IN')} · {e.type.replace(/_/g, ' ')}</li>)}</ul></div> : null}
        </div>}
      </DialogContent>
    </Dialog>
  );
}

function AvailabilityDialog({ onClose }: { onClose: () => void }) {
  const vw = visitWords(usePack());
  const { can, ctx } = useAuth(); const qc = useQueryClient(); const members = useMembers();
  const admin = can('settings:manage');
  const myMember = (members.data ?? []).find((m) => m.user.id === ctx.user.id);
  const [target, setTarget] = useState<string>(admin ? 'default' : '');
  const effective = target || myMember?.id || '';
  const view = useQuery({ queryKey: ['appointments', 'availability', effective], enabled: Boolean(effective), queryFn: () => api<AvailabilityView>(`/appointments/availability?membershipId=${effective}`) });
  const [draft, setDraft] = useState<Record<number, { on: boolean; start: string; end: string }> | null>(null);
  const [exDate, setExDate] = useState(''); const [exReason, setExReason] = useState(''); const [busy, setBusy] = useState(false);
  const rows = useMemo(() => {
    if (draft) return draft;
    const out: Record<number, { on: boolean; start: string; end: string }> = {};
    for (let d = 0; d < 7; d++) { const r = view.data?.rules.find((x) => x.dayOfWeek === d); out[d] = r ? { on: true, start: minuteLabel(r.startMinute), end: minuteLabel(r.endMinute) } : { on: view.data?.usingDefault ? d !== 0 : false, start: '10:00', end: '19:00' }; }
    return out;
  }, [draft, view.data]);
  const upd = (d: number, p: Partial<{ on: boolean; start: string; end: string }>) => setDraft({ ...rows, [d]: { ...(rows[d] as { on: boolean; start: string; end: string }), ...p } });
  async function save() {
    setBusy(true);
    try { await api('/appointments/availability', { method: 'PUT', body: { membershipId: effective === 'default' ? null : effective, rules: Object.entries(rows).filter(([, r]) => r.on).map(([d, r]) => ({ dayOfWeek: Number(d), startMinute: parseMinute(r.start), endMinute: parseMinute(r.end) })) } }); toast.success('Working hours saved'); setDraft(null); await qc.invalidateQueries({ queryKey: ['appointments'] }); }
    catch (e) { handleApiError(e); } finally { setBusy(false); }
  }
  async function addEx() { if (!exDate) return; try { await api('/appointments/availability/exceptions', { method: 'POST', body: { membershipId: effective === 'default' ? null : effective, date: exDate, reason: exReason || null } }); setExDate(''); setExReason(''); await qc.invalidateQueries({ queryKey: ['appointments', 'availability'] }); } catch (e) { handleApiError(e); } }
  async function delEx(id: string) { try { await api(`/appointments/availability/exceptions/${id}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['appointments', 'availability'] }); } catch (e) { handleApiError(e); } }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Working hours" description={`When ${vw.visits} can be booked`} className="max-w-xl">
        <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
          <Field label="Whose hours" htmlFor="av-who"><Select id="av-who" value={effective} onChange={(e) => { setTarget(e.target.value); setDraft(null); }}>{admin ? <option value="default">Everyone (workspace default)</option> : null}{(admin ? members.data ?? [] : myMember ? [myMember] : []).map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select></Field>
          {view.data ? <p className="text-helper">{view.data.usingDefault ? (effective === 'default' ? 'Nothing saved yet: Monday to Saturday, 10:00 to 19:00 applies.' : 'Using the workspace hours. Saving here gives this person their own.') : 'Custom hours.'} Times are in {view.data.timezone}.</p> : null}
          <div className="space-y-1.5">{DAY_NAMES.map((n, d) => { const r = rows[d] as { on: boolean; start: string; end: string }; return (
            <div key={n} className="flex items-center gap-2 text-[13px]"><label className="flex w-32 items-center gap-2"><input type="checkbox" checked={r.on} onChange={(e) => upd(d, { on: e.target.checked })} />{n}</label>
              {r.on ? <><Input aria-label={`${n} opens`} type="time" className="w-28" value={r.start} onChange={(e) => upd(d, { start: e.target.value })} /><span>to</span><Input aria-label={`${n} closes`} type="time" className="w-28" value={r.end} onChange={(e) => upd(d, { end: e.target.value })} /></> : <span className="text-helper">Not available</span>}</div>); })}</div>
          <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => void save()}>Save hours</Button></div>
          <div className="border-t border-border pt-3"><p className="text-label mb-2">Days off</p>
            <div className="flex flex-wrap items-end gap-2"><Field label="Date" htmlFor="ex-date"><Input id="ex-date" type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} /></Field><Field label="Reason" htmlFor="ex-reason" className="min-w-40 flex-1"><Input id="ex-reason" placeholder="Holiday, leave…" value={exReason} onChange={(e) => setExReason(e.target.value)} /></Field><Button onClick={() => void addEx()} disabled={!exDate}>Block day</Button></div>
            <ul className="mt-2 space-y-1">{(view.data?.exceptions ?? []).map((x) => <li key={x.id} className="flex items-center justify-between text-[13px]"><span>{x.date}{x.reason ? ` · ${x.reason}` : ''}</span><Button size="sm" variant="ghost" onClick={() => void delEx(x.id)}>Remove</Button></li>)}</ul></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AppointmentsPage() {
  const vw = visitWords(usePack());
  const { can } = useAuth(); const manager = can('appointment:read:all'); const write = can('appointment:write');
  const tzGuess = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [view, setView] = useState<'week' | 'list'>('week'); const [weekStart, setWeekStart] = useState(() => mondayOf(localDate(new Date(), tzGuess)));
  const [agent, setAgent] = useState(''); const [status, setStatus] = useState('');
  const [book, setBook] = useState(false); const [open, setOpen] = useState<string | null>(null); const [moving, setMoving] = useState<Appointment | null>(null); const [hours, setHours] = useState(false);
  const members = useMembers();
  const from = `${addDays(weekStart, -1)}T00:00:00Z`; const to = `${addDays(weekStart, 8)}T00:00:00Z`;
  const list = useQuery({ queryKey: ['appointments', 'list', view, weekStart, agent, status], queryFn: () => api<{ items: Appointment[]; timezone: string }>(`/appointments${view === 'week' ? qs({ from, to, membershipId: agent || undefined, limit: 500 }) : qs({ from: new Date(Date.now() - 86_400_000).toISOString(), status: status || undefined, membershipId: agent || undefined, limit: 200 })}`), placeholderData: (p) => p });
  const tz = list.data?.timezone ?? tzGuess;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = (d: string) => (list.data?.items ?? []).filter((a) => localDate(new Date(a.startsAt), tz) === d && a.status !== 'RESCHEDULED' && a.status !== 'CANCELLED');
  const today = localDate(new Date(), tz);

  return (
    <>
      <PageHeader title="Appointments" description={`${vw.visit === 'meeting' ? 'Meetings' : `${vw.Visits} and meetings`}. Double booking is impossible: the database refuses overlaps.`} actions={<>{write ? <Button onClick={() => setHours(true)}><Settings2 className="h-4 w-4" aria-hidden />Working hours</Button> : null}{write ? <Button variant="primary" onClick={() => setBook(true)}><Plus className="h-4 w-4" aria-hidden />Book {vw.visit}</Button> : null}</>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="View"><Button size="sm" variant={view === 'week' ? 'primary' : 'ghost'} onClick={() => setView('week')}><CalendarDays className="h-3.5 w-3.5" aria-hidden />Week</Button><Button size="sm" variant={view === 'list' ? 'primary' : 'ghost'} onClick={() => setView('list')}><List className="h-3.5 w-3.5" aria-hidden />Upcoming</Button></div>
          {view === 'week' ? <div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" onClick={() => setWeekStart(mondayOf(today))}>Today</Button><Button size="icon" variant="ghost" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button><span className="text-[13px] font-medium">{fmtDay(`${weekStart}T12:00:00Z`, 'UTC')} – {fmtDay(`${addDays(weekStart, 6)}T12:00:00Z`, 'UTC')}</span></div> : <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'].map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</Select>}
          {manager ? <Select aria-label="Agent" className="ml-auto w-auto" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All agents</option>{(members.data ?? []).filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select> : null}
        </div>
        {list.isPending ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div> : list.isError ? <EmptyState icon={CalendarDays} title="Could not load appointments" description="Please try again." action={<Button onClick={() => void list.refetch()}>Retry</Button>} /> : view === 'week' ? (
          <div className="overflow-x-auto"><div className="grid min-w-[840px] grid-cols-7 divide-x divide-border">{days.map((d) => (
            <div key={d} className={cn('min-h-64 p-2', d === today && 'bg-primary-soft/40')}>
              <p className={cn('text-label mb-2', d === today && 'text-primary')}>{fmtDay(`${d}T12:00:00Z`, 'UTC')}</p>
              <div className="space-y-1.5">{byDay(d).map((a) => (
                <button key={a.id} onClick={() => setOpen(a.id)} className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-left text-[12px] shadow-sm transition-colors hover:border-border-strong">
                  <span className="num font-medium">{fmtTime(a.startsAt, tz)}</span> <Badge tone={TONE[a.status]} className="ml-1 !px-1 !py-0 text-[10px]">{a.status === 'PENDING' ? 'Confirm' : LABEL[a.status]}</Badge>
                  <span className="block truncate">{a.leadName}</span>{manager ? <span className="text-helper block truncate">{a.agentName}</span> : null}</button>))}</div>
            </div>))}</div></div>
        ) : list.data.items.length === 0 ? <EmptyState icon={CalendarDays} title={`No upcoming ${vw.visits}`} description={`Book ${vw.a} from a lead, or let the AI assistant arrange them from chat.`} action={write ? <Button variant="primary" onClick={() => setBook(true)}>Book {vw.visit}</Button> : undefined} /> : (
          <div className="divide-y divide-border">{list.data.items.map((a) => (
            <button key={a.id} onClick={() => setOpen(a.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-[13px] hover:bg-muted/40"><span className="num w-44 shrink-0 font-medium">{fmtDay(a.startsAt, tz)}, {fmtTime(a.startsAt, tz)}</span><span className="min-w-0 flex-1 truncate">{a.leadName}{manager ? <span className="text-helper"> · {a.agentName}</span> : null}</span>{a.source === 'ai' ? <Badge tone="primary">AI</Badge> : null}<Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge></button>))}</div>
        )}
      </Card>
      {book ? <BookDialog onClose={() => setBook(false)} /> : null}
      {moving ? <BookDialog reschedule={moving} onClose={() => setMoving(null)} /> : null}
      {open ? <DetailDialog id={open} tz={tz} onClose={() => setOpen(null)} onReschedule={(a) => { setOpen(null); setMoving(a); }} /> : null}
      {hours ? <AvailabilityDialog onClose={() => setHours(false)} /> : null}
    </>
  );
}
