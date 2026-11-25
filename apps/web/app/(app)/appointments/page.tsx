'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, List, Plus, Settings2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { NoShowRecoveryDialog, type NoShowTarget } from '@/components/appointments/no-show-recovery-dialog';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AppointmentsCalendarSkeleton, AppointmentsTableSkeleton } from '@/components/skeletons';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/use-debounce';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs, useMembers } from '@/lib/crm';
import { useAppointmentConfig, usePack, useTerms, visitWords } from '@/lib/pack';
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

const bookAppointmentSchema = z.object({
  leadId: z.string().min(1, 'Please select a contact'),
  agent: z.string().optional(),
  serviceType: z.string().trim().max(100).optional(),
  duration: z.number().min(15).max(480),
  startsAt: z.string().min(1, 'Please pick an open time slot'),
  location: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

type BookAppointmentFormValues = z.infer<typeof bookAppointmentSchema>;

function BookDialog({ onClose, reschedule, initialLead }: { onClose: () => void; reschedule?: Appointment; initialLead?: { id: string; name: string } | null }) {
  const pack = usePack();
  const vw = visitWords(pack);
  const terms = useTerms();
  const appConfig = useAppointmentConfig();
  const qc = useQueryClient();
  const { can } = useAuth();
  const members = useMembers();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 250);
  const [lead, setLead] = useState<{ id: string; name: string } | null>(
    reschedule ? { id: reschedule.leadId, name: reschedule.leadName } : initialLead ?? null,
  );
  const leads = useQuery({
    queryKey: ['leads', 'picker', q],
    enabled: !reschedule && !lead,
    queryFn: () => api<{ items: { id: string; name: string; phone: string | null }[] }>(`/leads${qs({ q, pageSize: 6 })}`),
  });

  const manager = can('appointment:read:all');
  const eligible = (members.data ?? []).filter((m) => m.status === 'ACTIVE');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<BookAppointmentFormValues>({
    resolver: zodResolver(bookAppointmentSchema),
    defaultValues: {
      leadId: reschedule ? reschedule.leadId : initialLead?.id ?? '',
      agent: reschedule?.membershipId ?? '',
      serviceType: reschedule?.serviceType ?? appConfig.services[0] ?? '',
      duration: reschedule
        ? Math.round((new Date(reschedule.endsAt).getTime() - new Date(reschedule.startsAt).getTime()) / 60000)
        : appConfig.durations[0] ?? 60,
      startsAt: '',
      location: reschedule?.location ?? '',
      notes: reschedule?.notes ?? '',
    },
  });

  const currentAgent = watch('agent');
  const currentServiceType = watch('serviceType');
  const currentDuration = watch('duration');
  const currentStartsAt = watch('startsAt');

  async function onSubmit(data: BookAppointmentFormValues) {
    try {
      if (reschedule) {
        await api(`/appointments/${reschedule.id}/reschedule`, {
          method: 'POST',
          body: {
            startsAt: data.startsAt,
            durationMinutes: data.duration,
            ...(data.agent && manager ? { membershipId: data.agent } : {}),
          },
        });
      } else {
        await api('/appointments', {
          method: 'POST',
          body: {
            leadId: data.leadId,
            ...(data.agent ? { membershipId: data.agent } : {}),
            serviceType: data.serviceType || null,
            startsAt: data.startsAt,
            durationMinutes: data.duration,
            notes: data.notes || null,
            location: data.location || null,
          },
        });
      }
      toast.success(reschedule ? `${vw.Visit} rescheduled` : `${vw.Visit} booked`);
      await qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'slot_taken' || e.code === 'lead_busy')) {
        toast.error(e.message);
        await qc.invalidateQueries({ queryKey: ['appointments', 'slots'] });
        setValue('startsAt', '');
        setError('startsAt', { message: e.message });
      } else {
        handleApiError(e, setError);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={reschedule ? `Reschedule ${vw.visit}` : `Book ${vw.a}`} size="xl">
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col justify-between">
          <div className="grid gap-3.5">
            <FormErrorAlert errors={errors} />
            {reschedule ? (
              <p className="text-[13px]">{reschedule.leadName} · now {fmtDay(reschedule.startsAt, 'Asia/Kolkata')}</p>
            ) : lead ? (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]">
                <span className="font-medium">{lead.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setLead(null);
                    setValue('leadId', '');
                    setValue('startsAt', '');
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <Field label={appConfig.customerLabel || terms.Lead} htmlFor="b-lead" error={errors.leadId?.message}>
                <Input
                  id="b-lead"
                  autoFocus
                  placeholder="Search by name or phone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="mt-1 divide-y divide-border rounded-md border border-border">
                  {(leads.data?.items ?? []).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="flex w-full justify-between px-3 py-2 text-left text-[13px] hover:bg-muted"
                      onClick={() => {
                        setLead({ id: l.id, name: l.name });
                        setValue('leadId', l.id, { shouldValidate: true });
                        clearErrors('leadId');
                      }}
                    >
                      <span>{l.name}</span>
                      <span className="text-helper">{l.phone}</span>
                    </button>
                  ))}
                  {leads.data && leads.data.items.length === 0 ? (
                    <p className="text-helper px-3 py-2">No matching {terms.leads}.</p>
                  ) : null}
                </div>
              </Field>
            )}
            {lead ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Service / Type" htmlFor="b-service" error={errors.serviceType?.message}>
                    <Select
                      id="b-service"
                      value={currentServiceType}
                      onChange={(e) => setValue('serviceType', e.target.value)}
                    >
                      {appConfig.services.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Length" htmlFor="b-dur" error={errors.duration?.message}>
                    <Select
                      id="b-dur"
                      value={currentDuration}
                      onChange={(e) => {
                        setValue('duration', Number(e.target.value));
                        setValue('startsAt', '');
                      }}
                    >
                      {appConfig.durations.map((d) => (
                        <option key={d} value={d}>
                          {d} minutes
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {manager ? (
                  <Field label={appConfig.practitionerLabel} htmlFor="b-agent" error={errors.agent?.message}>
                    <Select
                      id="b-agent"
                      value={currentAgent}
                      onChange={(e) => {
                        setValue('agent', e.target.value);
                        setValue('startsAt', '');
                      }}
                    >
                      <option value="">Any available {appConfig.practitionerLabel.toLowerCase()}</option>
                      {eligible.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.user.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Slot" htmlFor="b-slot" error={errors.startsAt?.message}>
                  <SlotPicker
                    leadId={lead.id}
                    membershipId={currentAgent ?? ''}
                    duration={currentDuration}
                    value={currentStartsAt}
                    onChange={(iso, m) => {
                      setValue('startsAt', iso, { shouldValidate: true });
                      clearErrors('startsAt');
                      if (!currentAgent && m) setValue('agent', '');
                    }}
                  />
                </Field>
                {!reschedule ? (
                  <>
                    <Field label="Location" htmlFor="b-loc" error={errors.location?.message}>
                      <Input id="b-loc" placeholder={appConfig.locationPlaceholder} {...register('location')} />
                    </Field>
                    {appConfig.safetyNotice ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50/70 p-2.5 text-[12px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                        <span className="font-semibold">Privacy note:</span> {appConfig.safetyNotice}
                      </div>
                    ) : null}
                    <Field label="Notes" htmlFor="b-notes" error={errors.notes?.message}>
                      <Textarea id="b-notes" placeholder={appConfig.notesPlaceholder} rows={2} {...register('notes')} />
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!lead || !currentStartsAt}
              loading={isSubmitting}
            >
              {reschedule ? `Move ${vw.visit}` : `Book ${vw.visit}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ id, tz, onClose, onReschedule, onNoShow }: { id: string; tz: string; onClose: () => void; onReschedule: (a: Appointment) => void; onNoShow: (a: Appointment) => void }) {
  const pack = usePack();
  const vw = visitWords(pack);
  const terms = useTerms();
  const appConfig = useAppointmentConfig();
  const qc = useQueryClient(); const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['appointments', 'detail', id], queryFn: () => api<Appointment>(`/appointments/${id}`) });
  const act = useMutation({ mutationFn: (a: { path: string; body?: unknown }) => api<Appointment>(`/appointments/${id}/${a.path}`, { method: 'POST', body: a.body ?? {} }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['appointments'] }); toast.success('Updated'); }, onError: (e) => handleApiError(e) });
  const a = q.data; const active = a?.status === 'PENDING' || a?.status === 'CONFIRMED'; const [now] = useState(() => Date.now()); const started = a ? new Date(a.startsAt).getTime() <= now : false;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={a?.title ?? vw.Visit} size="xl">
        {!a ? <Skeleton className="h-40" /> : <div className="space-y-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge>
            {a.serviceType ? <Badge tone="neutral">{a.serviceType}</Badge> : null}
            {a.source === 'ai' ? <Badge tone="primary">Booked by AI</Badge> : null}
          </div>
          <p><Clock className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden />{fmtDay(a.startsAt, tz)}, {fmtTime(a.startsAt, tz)} – {fmtTime(a.endsAt, tz)}</p>
          <p><span className="text-muted-foreground">{appConfig.customerLabel || terms.Lead}:</span> {a.leadName}{a.leadPhone ? ` · ${a.leadPhone}` : ''}</p>
          <p><span className="text-muted-foreground">{appConfig.practitionerLabel}:</span> {a.agentName}</p>
          {a.location ? <p><span className="text-muted-foreground">Where:</span> {a.location}</p> : null}
          {a.notes ? <p className="whitespace-pre-wrap">{a.notes}</p> : null}
          {a.cancelledReason ? <p className="text-muted-foreground">Cancelled: {a.cancelledReason}</p> : null}
          {active ? <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {a.status === 'PENDING' ? <Button variant="primary" size="sm" loading={act.isPending} onClick={() => act.mutate({ path: 'confirm' })}>Confirm</Button> : null}
            <Button size="sm" onClick={() => onReschedule(a)}>Reschedule</Button>
            {started ? <><Button size="sm" onClick={() => act.mutate({ path: 'complete' })}>Mark completed</Button><Button size="sm" variant="danger" onClick={() => { onClose(); onNoShow(a); }}>Mark No-show</Button></> : null}
          </div> : null}
          {active ? <div className="flex gap-2"><Input aria-label="Cancellation reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="danger" onClick={() => act.mutate({ path: 'cancel', body: { reason: reason || undefined } })}>Cancel {vw.visit}</Button></div> : null}
          {a.events?.length ? <div className="border-t border-border pt-3"><p className="text-label mb-1">History</p><ul className="space-y-1">{a.events.map((e) => <li key={e.id} className="text-helper">{new Date(e.createdAt).toLocaleString('en-IN')} · {e.type.replace(/_/g, ' ')}</li>)}</ul></div> : null}
        </div>}
      </DialogContent>
    </Dialog>
  );
}

function AvailabilityDialog({ onClose }: { onClose: () => void }) {
  const pack = usePack();
  const vw = visitWords(pack);
  const appConfig = useAppointmentConfig();
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
      <DialogContent title="Working hours" description={`When ${vw.visits} can be booked`} size="xl">
        <div className="space-y-4">
          <Field label={`Whose hours (${appConfig.practitionerLabel})`} htmlFor="av-who"><Select id="av-who" value={effective} onChange={(e) => { setTarget(e.target.value); setDraft(null); }}>{admin ? <option value="default">Everyone (workspace default)</option> : null}{(admin ? members.data ?? [] : myMember ? [myMember] : []).map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select></Field>
          {view.data ? <p className="text-helper">{view.data.usingDefault ? (effective === 'default' ? 'Nothing saved yet: Monday to Saturday, 10:00 to 19:00 applies.' : 'Using the workspace hours. Saving here gives this person their own.') : 'Custom hours.'} Times are in {view.data.timezone}.</p> : null}
          <div className="space-y-1.5">{DAY_NAMES.map((n, d) => { const r = rows[d] as { on: boolean; start: string; end: string }; return (
            <div key={n} className="flex flex-wrap sm:flex-nowrap items-center gap-2 text-[13px]"><label className="flex w-28 sm:w-32 items-center gap-2"><input type="checkbox" checked={r.on} onChange={(e) => upd(d, { on: e.target.checked })} />{n}</label>
              {r.on ? <div className="flex items-center gap-2"><Input aria-label={`${n} opens`} type="time" className="w-36 px-2.5" value={r.start} onChange={(e) => upd(d, { start: e.target.value })} /><span className="text-muted-foreground">to</span><Input aria-label={`${n} closes`} type="time" className="w-36 px-2.5" value={r.end} onChange={(e) => upd(d, { end: e.target.value })} /></div> : <span className="text-helper">Not available</span>}</div>); })}</div>
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
  const pack = usePack();
  const vw = visitWords(pack);
  const terms = useTerms();
  const appConfig = useAppointmentConfig();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const bookLeadId = searchParams.get('bookLeadId');
  const bookLeadName = searchParams.get('bookLeadName');
  const initialLead = useMemo(
    () => (bookLeadId ? { id: bookLeadId, name: bookLeadName || 'Selected contact' } : null),
    [bookLeadId, bookLeadName]
  );

  const { can } = useAuth(); const manager = can('appointment:read:all'); const write = can('appointment:write');
  const tzGuess = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [view, setView] = useState<'week' | 'list'>('week'); const [weekStart, setWeekStart] = useState(() => mondayOf(localDate(new Date(), tzGuess)));
  const [agent, setAgent] = useState(''); const [status, setStatus] = useState('');
  const [book, setBook] = useState(false); const [open, setOpen] = useState<string | null>(null); const [moving, setMoving] = useState<Appointment | null>(null); const [hours, setHours] = useState(false);
  const [noShowTarget, setNoShowTarget] = useState<NoShowTarget | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncs UI state after mount or when the dialog/query input changes
    if (bookLeadId) setBook(true);
  }, [bookLeadId]);

  const quickAct = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) =>
      api<Appointment>(`/appointments/${id}/${path}`, { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success('Updated');
    },
    onError: (e) => handleApiError(e),
  });

  const members = useMembers();
  const from = `${addDays(weekStart, -1)}T00:00:00Z`; const to = `${addDays(weekStart, 8)}T00:00:00Z`;
  const list = useQuery({ queryKey: ['appointments', 'list', view, weekStart, agent, status], queryFn: () => api<{ items: Appointment[]; timezone: string }>(`/appointments${view === 'week' ? qs({ from, to, membershipId: agent || undefined, limit: 500 }) : qs({ from: new Date(Date.now() - 86_400_000).toISOString(), status: status || undefined, membershipId: agent || undefined, limit: 200 })}`), placeholderData: (p) => p });
  const tz = list.data?.timezone ?? tzGuess;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = (d: string) => (list.data?.items ?? []).filter((a) => localDate(new Date(a.startsAt), tz) === d && a.status !== 'RESCHEDULED' && a.status !== 'CANCELLED');
  const today = localDate(new Date(), tz);

  return (
    <>
      <PageHeader
        title={vw.visit === 'meeting' ? 'Appointments' : vw.Visits}
        description={`Schedule and manage ${vw.visits} for ${terms.leads}. Double booking is impossible: the database refuses overlaps.`}
        actions={<div data-tour="appointments-actions" className="flex flex-wrap items-center gap-2">{write ? <Button onClick={() => setHours(true)}><Settings2 className="h-4 w-4" aria-hidden />Working hours</Button> : null}{write ? <Button variant="primary" onClick={() => setBook(true)}><Plus className="h-4 w-4" aria-hidden />Book {vw.visit}</Button> : null}</div>}
      />
      <Card data-tour="appointments-list" className="overflow-hidden">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface/95 backdrop-blur-xs p-3">
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="View"><Button size="sm" variant={view === 'week' ? 'primary' : 'ghost'} onClick={() => setView('week')}><CalendarDays className="h-3.5 w-3.5" aria-hidden />Week</Button><Button size="sm" variant={view === 'list' ? 'primary' : 'ghost'} onClick={() => setView('list')}><List className="h-3.5 w-3.5" aria-hidden />Upcoming</Button></div>
          {view === 'week' ? <div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" onClick={() => setWeekStart(mondayOf(today))}>Today</Button><Button size="icon" variant="ghost" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button><span className="text-[13px] font-medium">{fmtDay(`${weekStart}T12:00:00Z`, 'UTC')} – {fmtDay(`${addDays(weekStart, 6)}T12:00:00Z`, 'UTC')}</span></div> : <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'].map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</Select>}
          {manager ? <Select aria-label="Agent" className="ml-auto w-auto" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All {appConfig.practitionerLabel.toLowerCase()}s</option>{(members.data ?? []).filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select> : null}
        </div>
        {list.isPending ? (
          view === 'week' ? <AppointmentsCalendarSkeleton /> : <AppointmentsTableSkeleton />
        ) : list.isError ? <EmptyState icon={CalendarDays} title="Could not load appointments" description="Please try again." action={<Button onClick={() => void list.refetch()}>Retry</Button>} /> : view === 'week' ? (
          <div className="overflow-x-auto"><div className="grid min-w-[840px] grid-cols-7 divide-x divide-border">{days.map((d) => (
            <div key={d} className={cn('min-h-64 p-2', d === today && 'bg-primary-soft/40')}>
              <p className={cn('text-label mb-2', d === today && 'text-primary')}>{fmtDay(`${d}T12:00:00Z`, 'UTC')}</p>
              <div className="space-y-1.5">{byDay(d).map((a) => (
                <button key={a.id} onClick={() => setOpen(a.id)} className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-left text-[12px] shadow-sm transition-colors hover:border-border-strong">
                  <div className="flex items-center justify-between">
                    <span className="num font-medium">{fmtTime(a.startsAt, tz)}</span>
                    <Badge tone={TONE[a.status]} className="ml-1 !px-1 !py-0 text-[10px]">{a.status === 'PENDING' ? 'Confirm' : LABEL[a.status]}</Badge>
                  </div>
                  <span className="block truncate font-medium mt-0.5">{a.leadName}</span>
                  {a.serviceType ? <span className="block truncate text-[11px] text-primary">{a.serviceType}</span> : null}
                  {manager ? <span className="text-helper block truncate">{a.agentName}</span> : null}
                </button>))}</div>
            </div>))}</div></div>
        ) : list.data.items.length === 0 ? <EmptyState icon={CalendarDays} title={`No upcoming ${vw.visits}`} description={`Book ${vw.a} from ${terms.aLead}, or let the AI assistant arrange them from chat.`} action={write ? <Button variant="primary" onClick={() => setBook(true)}>Book {vw.visit}</Button> : undefined} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-surface text-label text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">{appConfig.customerLabel || terms.Lead}</th>
                  <th className="px-4 py-2.5 font-medium">Service / Type</th>
                  <th className="px-4 py-2.5 font-medium">{appConfig.practitionerLabel}</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium text-right">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.items.map((a) => (
                  <tr key={a.id} onClick={() => setOpen(a.id)} className="cursor-pointer hover:bg-muted/40 transition-colors">
                    <td className="num px-4 py-3 font-medium whitespace-nowrap">{fmtDay(a.startsAt, tz)}, {fmtTime(a.startsAt, tz)}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{a.leadName}</td>
                    <td className="px-4 py-3"><span className="rounded bg-muted px-2 py-0.5 text-[12px] font-medium text-foreground">{a.serviceType ?? vw.Visit}</span></td>
                    <td className="px-4 py-3 text-helper">{a.agentName}</td>
                    <td className="px-4 py-3">{a.source === 'ai' ? <Badge tone="primary">AI</Badge> : <span className="text-helper">Direct</span>}</td>
                    <td className="px-4 py-3 text-right"><Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {a.status === 'PENDING' ? (
                          <Button
                            size="sm"
                            variant="primary"
                            loading={quickAct.isPending}
                            onClick={() => quickAct.mutate({ id: a.id, path: 'confirm' })}
                          >
                            Confirm
                          </Button>
                        ) : null}
                        {/* eslint-disable-next-line react-hooks/purity -- elapsed-time check; re-evaluated on each render by design */}
                        {(a.status === 'PENDING' || a.status === 'CONFIRMED') && new Date(a.startsAt).getTime() <= Date.now() ? (
                          <>
                            <Button
                              size="sm"
                              loading={quickAct.isPending}
                              onClick={() => quickAct.mutate({ id: a.id, path: 'complete' })}
                            >
                              Complete
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                setNoShowTarget({
                                  id: a.id,
                                  leadId: a.leadId,
                                  leadName: a.leadName,
                                  leadPhone: a.leadPhone,
                                  serviceType: a.serviceType,
                                  title: a.title,
                                  startsAt: a.startsAt,
                                })
                              }
                            >
                              No-show
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {book ? <BookDialog initialLead={initialLead} onClose={() => setBook(false)} /> : null}
      {moving ? <BookDialog reschedule={moving} onClose={() => setMoving(null)} /> : null}
      {open ? (
        <DetailDialog
          id={open}
          tz={tz}
          onClose={() => setOpen(null)}
          onReschedule={(a) => {
            setOpen(null);
            setMoving(a);
          }}
          onNoShow={(a) => {
            setNoShowTarget({
              id: a.id,
              leadId: a.leadId,
              leadName: a.leadName,
              leadPhone: a.leadPhone,
              serviceType: a.serviceType,
              title: a.title,
              startsAt: a.startsAt,
            });
          }}
        />
      ) : null}
      {hours ? <AvailabilityDialog onClose={() => setHours(false)} /> : null}
      <NoShowRecoveryDialog
        appointment={noShowTarget}
        open={Boolean(noShowTarget)}
        onOpenChange={(o) => {
          if (!o) setNoShowTarget(null);
        }}
        onSuccess={() => setNoShowTarget(null)}
      />
    </>
  );
}
