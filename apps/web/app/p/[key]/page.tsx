'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, CheckCircle2, Clock, LogOut, MapPin, Shield, User, XCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { handleApiError } from '@/lib/forms';

interface PortalPageMeta {
  businessName: string;
  logoUrl: string | null;
}

interface PortalMe {
  businessName: string;
  logoUrl: string | null;
  firstName: string;
  timezone: string;
  appointmentNoun: string;
  appointmentNounPlural: string;
  allow: { confirm: boolean; cancel: boolean; reschedule: boolean };
  cancelCutoffHours: number;
}

interface PortalAppointment {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  location: string | null;
  agentFirstName: string | null;
  canConfirm: boolean;
  canCancel: boolean;
  canReschedule: boolean;
}

interface PortalAppointmentsResponse {
  upcoming: PortalAppointment[];
  past: PortalAppointment[];
}

interface SlotDay {
  date: string;
  slots: { startsAt: string; endsAt: string; membershipIds: string[] }[];
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'primary'> = {
  CONFIRMED: 'success',
  PENDING: 'warning',
  CANCELLED: 'danger',
  RESCHEDULED: 'neutral',
  COMPLETED: 'primary',
};

function fmtDateTime(iso: string, tz: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }),
  };
}

function SignInView({ portalKey, meta, onSignedIn }: { portalKey: string; meta: PortalPageMeta; onSignedIn: () => Promise<void> }) {
  const [identity, setIdentity] = useState('');
  const [step, setStep] = useState<'identity' | 'code'>('identity');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/portal/${portalKey}/code`, { method: 'POST', body: { identity } });
      setStep('code');
      toast.success('If your details match a record, a verification code has been sent.');
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/portal/${portalKey}/verify`, { method: 'POST', body: { identity, code } });
      await onSignedIn();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <p className="text-label text-muted-foreground">Customer portal</p>
          <CardTitle className="text-lg">{meta.businessName}</CardTitle>
        </CardHeader>
        <CardBody>
          {step === 'identity' ? (
            <form onSubmit={(e) => void requestCode(e)} className="space-y-4">
              <Field label="Phone number or email" htmlFor="p-identity" hint="We will send a 6-digit one-time code to your contact on file.">
                <Input
                  id="p-identity"
                  required
                  autoFocus
                  placeholder="+91 98765 43210 or you@example.com"
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="primary" className="w-full" loading={busy}>
                Send verification code
              </Button>
            </form>
          ) : (
            <form onSubmit={(e) => void verify(e)} className="space-y-4">
              <Field label="6-digit verification code" htmlFor="p-code" hint={`Sent for ${identity}`}>
                <Input
                  id="p-code"
                  required
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => { setStep('identity'); setCode(''); }}>
                  Back
                </Button>
                <Button type="submit" variant="primary" className="flex-1" loading={busy}>
                  Sign in
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function RescheduleDialog({
  appt,
  tz,
  onClose,
  onDone,
}: {
  appt: PortalAppointment | null;
  tz: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string>('');
  const [reason, setReason] = useState('');
  const slots = useQuery({
    queryKey: ['portal', 'slots', appt?.id],
    enabled: !!appt,
    queryFn: () => api<SlotDay[]>(`/portal/appointments/${appt?.id}/slots`),
  });
  const submit = useMutation({
    mutationFn: () =>
      api(`/portal/appointments/${appt?.id}/reschedule`, {
        method: 'POST',
        body: { startsAt: selected, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      }),
    onSuccess: async () => {
      toast.success('Appointment rescheduled');
      setSelected('');
      setReason('');
      await onDone();
      onClose();
    },
    onError: (e) => handleApiError(e),
  });

  return (
    <Dialog open={appt !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Choose a new time" description={appt ? appt.title : ''}>
        <div className="space-y-4">
          {slots.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : slots.isError ? (
            <p className="text-[13px] text-danger">Could not load available times.</p>
          ) : (
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {slots.data.filter((d) => d.slots.length > 0).length === 0 ? (
                <p className="text-helper">No open slots available in the next 7 days. Please contact our team directly.</p>
              ) : (
                slots.data
                  .filter((d) => d.slots.length > 0)
                  .map((day) => (
                    <div key={day.date} className="space-y-1.5">
                      <p className="text-label text-muted-foreground">{day.date}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {day.slots.map((s) => {
                          const label = fmtDateTime(s.startsAt, tz).time;
                          const active = selected === s.startsAt;
                          return (
                            <Button
                              key={s.startsAt}
                              type="button"
                              size="sm"
                              variant={active ? 'primary' : 'secondary'}
                              onClick={() => setSelected(s.startsAt)}
                            >
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ))
              )}
            </div>
          )}
          <Field label="Reason (optional)" htmlFor="p-resched-reason">
            <Input id="p-resched-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note for the team" />
          </Field>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" onClick={onClose}>
              Close
            </Button>
            <Button type="button" variant="primary" disabled={!selected} loading={submit.isPending} onClick={() => submit.mutate()}>
              Confirm new time
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PortalPage() {
  const { key } = useParams<{ key: string }>();
  const qc = useQueryClient();

  const meta = useQuery({
    queryKey: ['portal', 'meta', key],
    queryFn: () => api<PortalPageMeta>(`/portal/${key}`),
    retry: false,
  });

  const me = useQuery({
    queryKey: ['portal', 'me'],
    queryFn: () => api<PortalMe>('/portal/me'),
    enabled: meta.isSuccess,
    retry: false,
  });

  const appts = useQuery({
    queryKey: ['portal', 'appointments'],
    queryFn: () => api<PortalAppointmentsResponse>('/portal/appointments'),
    enabled: me.isSuccess,
  });

  const [cancelTarget, setCancelTarget] = useState<PortalAppointment | null>(null);
  const [reschedTarget, setReschedTarget] = useState<PortalAppointment | null>(null);
  const [dataNote, setDataNote] = useState('');

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['portal'] });
  };

  const confirmMut = useMutation({
    mutationFn: (id: string) => api(`/portal/appointments/${id}/confirm`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Confirmed');
      await refresh();
    },
    onError: (e) => handleApiError(e),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api(`/portal/appointments/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      toast.success('Cancelled');
      setCancelTarget(null);
      await refresh();
    },
    onError: (e) => handleApiError(e),
  });

  const dataMut = useMutation({
    mutationFn: (type: 'export' | 'erase') =>
      api<{ ok: boolean; status: string }>('/portal/data-request', {
        method: 'POST',
        body: { type, ...(dataNote.trim() ? { note: dataNote.trim() } : {}) },
      }),
    onSuccess: (res) => {
      toast.success(res.status);
      setDataNote('');
    },
    onError: (e) => handleApiError(e),
  });

  const logoutMut = useMutation({
    mutationFn: () => api('/portal/logout', { method: 'POST' }),
    onSuccess: async () => {
      await qc.resetQueries({ queryKey: ['portal'] });
    },
  });

  if (meta.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-12">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-44" />
      </div>
    );
  }

  if (meta.isError || !meta.data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="text-title">Page unavailable</h1>
        <p className="text-helper mt-1">This customer portal link is inactive or no longer valid.</p>
      </div>
    );
  }

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-12">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-44" />
      </div>
    );
  }

  if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
    return <SignInView portalKey={key} meta={meta.data} onSignedIn={refresh} />;
  }

  if (!me.data) {
    return <SignInView portalKey={key} meta={meta.data} onSignedIn={refresh} />;
  }

  const m = me.data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-label text-muted-foreground">{m.businessName}</p>
          <h1 className="text-title">Hi, {m.firstName}</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => logoutMut.mutate()} loading={logoutMut.isPending}>
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </Button>
      </header>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" aria-hidden />
              Upcoming {m.appointmentNounPlural.toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {appts.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : !appts.data || appts.data.upcoming.length === 0 ? (
              <p className="text-helper">No upcoming {m.appointmentNounPlural.toLowerCase()} scheduled.</p>
            ) : (
              <ul className="divide-y divide-border">
                {appts.data.upcoming.map((a) => {
                  const dt = fmtDateTime(a.startsAt, m.timezone);
                  return (
                    <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium">{a.title}</span>
                          <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                        </div>
                        <p className="text-helper flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{dt.date} · {dt.time}</span>
                          {a.location ? <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{a.location}</span> : null}
                          {a.agentFirstName ? <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" aria-hidden />With {a.agentFirstName}</span> : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {a.canConfirm ? (
                          <Button size="sm" variant="primary" loading={confirmMut.isPending} onClick={() => confirmMut.mutate(a.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                            Confirm
                          </Button>
                        ) : null}
                        {a.canReschedule ? (
                          <Button size="sm" variant="secondary" onClick={() => setReschedTarget(a)}>
                            Reschedule
                          </Button>
                        ) : null}
                        {a.canCancel ? (
                          <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setCancelTarget(a)}>
                            <XCircle className="h-3.5 w-3.5" aria-hidden />
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {appts.data && appts.data.past.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Past {m.appointmentNounPlural.toLowerCase()}</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-border">
                {appts.data.past.map((a) => {
                  const dt = fmtDateTime(a.startsAt, m.timezone);
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 text-[13px]">
                      <div>
                        <p className="font-medium">{a.title}</p>
                        <p className="text-helper">{dt.date} · {dt.time}</p>
                      </div>
                      <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" aria-hidden />
              My data & privacy
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-helper">Request a copy of your personal data or ask our team to erase your records.</p>
            <Textarea
              aria-label="Optional note for your data request"
              placeholder="Optional note (e.g. preferred email for your data export)…"
              value={dataNote}
              onChange={(e) => setDataNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" loading={dataMut.isPending} onClick={() => dataMut.mutate('export')}>
                Request data export
              </Button>
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" loading={dataMut.isPending} onClick={() => dataMut.mutate('erase')}>
                Request data erasure
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        danger
        title={`Cancel this ${m.appointmentNoun}?`}
        description={cancelTarget ? `You are cancelling "${cancelTarget.title}". Our team will be notified.` : ''}
        confirmLabel={`Cancel ${m.appointmentNoun}`}
        onConfirm={async () => {
          if (cancelTarget) await cancelMut.mutateAsync(cancelTarget.id);
        }}
      />
      <RescheduleDialog
        appt={reschedTarget}
        tz={m.timezone}
        onClose={() => setReschedTarget(null)}
        onDone={refresh}
      />
    </div>
  );
}
