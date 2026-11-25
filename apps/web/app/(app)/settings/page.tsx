'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { INDUSTRIES, updateTenantSchema, type UpdateTenantInput } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { WorkspacePrivacy } from '@/components/privacy/workspace-privacy';
import { CannedResponsesCard } from '@/components/settings/canned-responses-card';
import { SsoConfigCard } from '@/components/settings/sso-config-card';
import { SupportAccessCard } from '@/components/support/support-access-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CURRENCIES, getAllTimezones } from '@/lib/i18n';
import { useTerms } from '@/lib/pack';
import { cn } from '@/lib/cn';
import { handleApiError } from '@/lib/forms';
import { useTheme, type ThemePreference } from '@/lib/theme';

interface Tenant { name: string; email: string; phone: string | null; website: string | null; address: string | null; industry: string; timezone: string; currency: string }
interface SessionRow { id: string; ip: string | null; userAgent: string | null; lastUsedAt: string; current: boolean }

function BusinessProfile() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const canEdit = can('settings:manage');
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api<Tenant>('/tenant') });
  const timezones = useMemo(() => getAllTimezones(), []);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateTenantInput>({ resolver: zodResolver(updateTenantSchema) });

  useEffect(() => {
    if (tenant.data) {
      reset({
        ...tenant.data,
        phone: tenant.data.phone ?? null,
        website: tenant.data.website ?? null,
        address: tenant.data.address ?? null,
      } as UpdateTenantInput);
    }
  }, [tenant.data, reset]);

  const currentIndustry = watch('industry');
  const currentTimezone = watch('timezone');
  const currentCurrency = watch('currency');

  async function onSubmit(v: UpdateTenantInput) {
    const clean = { ...v, phone: v.phone || null, website: v.website || null, address: v.address || null };
    try {
      await api('/tenant', { method: 'PATCH', body: clean });
      toast.success('Business profile saved');
      await qc.invalidateQueries({ queryKey: ['tenant'] });
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      router.refresh();
    }
    catch (e) { handleApiError(e, setError); }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Business profile</CardTitle>{!canEdit ? <Badge>Read only</Badge> : null}</CardHeader>
      <CardBody>
        {tenant.isPending ? <div className="space-y-3"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div> : (
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Business name" htmlFor="name" error={errors.name?.message}><Input id="name" disabled={!canEdit} {...register('name')} /></Field>
            <Field label="Business email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" disabled={!canEdit} {...register('email')} /></Field>
            <Field label="Phone" htmlFor="phone" error={errors.phone?.message}><Input id="phone" disabled={!canEdit} {...register('phone')} /></Field>
            <Field label="Website" htmlFor="website" error={errors.website?.message} hint="Include https://"><Input id="website" disabled={!canEdit} {...register('website')} /></Field>
            <Field label="Industry" htmlFor="industry" error={errors.industry?.message}>
              <Select
                id="industry"
                disabled={!canEdit}
                value={currentIndustry ?? ''}
                onChange={(e) => setValue('industry', e.target.value as UpdateTenantInput['industry'], { shouldDirty: true, shouldValidate: true })}
              >
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i} className="capitalize">
                    {i.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Timezone" htmlFor="timezone" error={errors.timezone?.message}>
              <Select
                id="timezone"
                disabled={!canEdit}
                value={currentTimezone ?? ''}
                onChange={(e) => setValue('timezone', e.target.value, { shouldDirty: true, shouldValidate: true })}
              >
                {timezones.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" htmlFor="currency" error={errors.currency?.message}>
              <Select
                id="currency"
                disabled={!canEdit}
                value={currentCurrency ?? ''}
                onChange={(e) => setValue('currency', e.target.value.toUpperCase(), { shouldDirty: true, shouldValidate: true })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
                {currentCurrency && !CURRENCIES.some((c) => c.code === currentCurrency) ? (
                  <option value={currentCurrency}>{currentCurrency}</option>
                ) : null}
              </Select>
            </Field>
            <Field label="Address" htmlFor="address" error={errors.address?.message} className="sm:col-span-2"><Input id="address" disabled={!canEdit} {...register('address')} /></Field>
            {canEdit ? <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={isSubmitting} disabled={!isDirty}>Save changes</Button></div> : null}
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function Assignment() {
  const { can } = useAuth();
  const terms = useTerms();
  const qc = useQueryClient();
  const canEdit = can('settings:manage');
  const cfg = useQuery({ queryKey: ['tenant', 'assignment'], queryFn: () => api<{ strategy: 'manual' | 'round_robin' }>('/tenant/assignment') });
  const save = useMutation({ mutationFn: (strategy: string) => api('/tenant/assignment', { method: 'PUT', body: { strategy } }), onSuccess: async () => { toast.success('Assignment rule saved'); await qc.invalidateQueries({ queryKey: ['tenant', 'assignment'] }); }, onError: (e) => handleApiError(e) });
  return (
    <Card>
      <CardHeader><CardTitle>{terms.Lead} assignment</CardTitle>{!canEdit ? <Badge>Read only</Badge> : null}</CardHeader>
      <CardBody>
        {cfg.isPending ? <Skeleton className="h-9" /> : (
          <div className="max-w-md space-y-2">
            <Field label={`When a new ${terms.lead} arrives`} htmlFor="assign-rule"><select id="assign-rule" disabled={!canEdit || save.isPending} value={cfg.data?.strategy} onChange={(e) => save.mutate(e.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px]"><option value="manual">Leave unassigned for a manager</option><option value="round_robin">Share equally between sales agents (round robin)</option></select></Field>
            <p className="text-helper">Round robin skips deactivated people and falls back to managers if there are no agents.</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Appearance() {
  const { preference, setPreference } = useTheme();
  const opts: { v: ThemePreference; label: string; icon: typeof Sun }[] = [{ v: 'light', label: 'Light', icon: Sun }, { v: 'dark', label: 'Dark', icon: Moon }, { v: 'system', label: 'System', icon: Monitor }];
  return (
    <Card>
      <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
      <CardBody>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 sm:max-w-md">
          {opts.map((o) => (
            <button key={o.v} role="radio" aria-checked={preference === o.v} onClick={() => setPreference(o.v)} className={cn('flex flex-col items-center gap-2 rounded-lg border p-4 text-[13px] transition-colors', preference === o.v ? 'border-primary bg-primary-soft text-accent-foreground' : 'border-border hover:bg-muted')}>
              <o.icon className="h-5 w-5" aria-hidden />{o.label}
            </button>
          ))}
        </div>
        <p className="text-helper mt-3">System follows your device setting and updates automatically.</p>
      </CardBody>
    </Card>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionRow[]>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Session signed out'); void qc.invalidateQueries({ queryKey: ['sessions'] }); }, onError: (e) => handleApiError(e) });
  return (
    <Card>
      <CardHeader><CardTitle>Active sessions</CardTitle></CardHeader>
      {sessions.isPending ? <div className="p-5"><Skeleton className="h-10" /></div> : (
        <ul className="divide-y divide-border">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1"><p className="truncate text-[13px]">{s.userAgent ?? 'Unknown device'}</p><p className="text-helper">{s.ip ?? 'Unknown IP'} · last active {new Date(s.lastUsedAt).toLocaleString()}</p></div>
              {s.current ? <Badge tone="success">This device</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ResponseTime() {
  const { can } = useAuth(); const qc = useQueryClient(); const canEdit = can('settings:manage');
  const q = useQuery({ queryKey: ['sla'], enabled: canEdit || can('analytics:read:team'), queryFn: () => api<{ settings: { enabled: boolean; firstResponseMinutes: number }; last30Days: { breaches: number; open: number; avgMinutesToRespond: number | null } }>('/sla') });
  const [minutes, setMinutes] = useState<string | null>(null); const [enabled, setEnabled] = useState<boolean | null>(null);
  const save = useMutation({ mutationFn: () => api('/sla', { method: 'PUT', body: { enabled: enabled ?? q.data?.settings.enabled ?? true, firstResponseMinutes: Number(minutes ?? q.data?.settings.firstResponseMinutes ?? 15) } }), onSuccess: async () => { toast.success('Response-time target saved'); setMinutes(null); setEnabled(null); await qc.invalidateQueries({ queryKey: ['sla'] }); }, onError: (e) => handleApiError(e) });
  if (!q.data) return null;
  const on = enabled ?? q.data.settings.enabled;
  return (
    <Card>
      <CardHeader><CardTitle>Response-time target</CardTitle>{!canEdit ? <Badge>Read only</Badge> : null}</CardHeader>
      <CardBody>
        <p className="text-helper mb-3">When a customer writes to a conversation your team handles and nobody replies in time, you and your managers get an alert. Chats the AI assistant is answering are not counted.</p>
        <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" disabled={!canEdit} checked={on} onChange={(e) => setEnabled(e.target.checked)} />Track first-response time</label>
        <div className="flex flex-wrap items-end gap-3"><div className="w-40"><label htmlFor="sla-min" className="text-label mb-1.5 block">Reply within (minutes)</label><Input id="sla-min" inputMode="numeric" disabled={!canEdit || !on} value={minutes ?? String(q.data.settings.firstResponseMinutes)} onChange={(e) => setMinutes(e.target.value)} /></div>{canEdit ? <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button> : null}</div>
        <p className="text-helper mt-3">Last 30 days: {q.data.last30Days.breaches} missed target{q.data.last30Days.breaches === 1 ? '' : 's'}, {q.data.last30Days.open} still waiting{q.data.last30Days.avgMinutesToRespond !== null ? `, average late reply after ${q.data.last30Days.avgMinutesToRespond} min` : ''}.</p>
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your workspace profile, appearance and security." />
      <div className="space-y-6"><BusinessProfile /><Assignment /><ResponseTime /><CannedResponsesCard /><SsoConfigCard /><Appearance /><Sessions /><SupportAccessCard /><WorkspacePrivacy /></div>
    </>
  );
}
