'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { INDUSTRIES, updateTenantSchema, type UpdateTenantInput } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { handleApiError } from '@/lib/forms';
import { useTheme, type ThemePreference } from '@/lib/theme';

interface Tenant { name: string; email: string; phone: string | null; website: string | null; address: string | null; industry: string; timezone: string; currency: string }
interface SessionRow { id: string; ip: string | null; userAgent: string | null; lastUsedAt: string; current: boolean }

function BusinessProfile() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can('settings:manage');
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api<Tenant>('/tenant') });
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<UpdateTenantInput>({ resolver: zodResolver(updateTenantSchema) });
  useEffect(() => { if (tenant.data) reset({ ...tenant.data, phone: tenant.data.phone ?? null, website: tenant.data.website ?? null, address: tenant.data.address ?? null } as UpdateTenantInput); }, [tenant.data, reset]);

  async function onSubmit(v: UpdateTenantInput) {
    const clean = { ...v, phone: v.phone || null, website: v.website || null, address: v.address || null };
    try { await api('/tenant', { method: 'PATCH', body: clean }); toast.success('Business profile saved'); await qc.invalidateQueries({ queryKey: ['tenant'] }); await qc.invalidateQueries({ queryKey: ['auth', 'me'] }); }
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
            <Field label="Industry" htmlFor="industry"><select id="industry" disabled={!canEdit} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] capitalize" {...register('industry')}>{INDUSTRIES.map((i) => <option key={i} value={i}>{i.replace('_', ' ')}</option>)}</select></Field>
            <Field label="Timezone" htmlFor="timezone" error={errors.timezone?.message}><Input id="timezone" disabled={!canEdit} {...register('timezone')} /></Field>
            <Field label="Currency" htmlFor="currency" error={errors.currency?.message}><Input id="currency" maxLength={3} disabled={!canEdit} {...register('currency')} /></Field>
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
  const qc = useQueryClient();
  const canEdit = can('settings:manage');
  const cfg = useQuery({ queryKey: ['tenant', 'assignment'], queryFn: () => api<{ strategy: 'manual' | 'round_robin' }>('/tenant/assignment') });
  const save = useMutation({ mutationFn: (strategy: string) => api('/tenant/assignment', { method: 'PUT', body: { strategy } }), onSuccess: async () => { toast.success('Assignment rule saved'); await qc.invalidateQueries({ queryKey: ['tenant', 'assignment'] }); }, onError: (e) => handleApiError(e) });
  return (
    <Card>
      <CardHeader><CardTitle>Lead assignment</CardTitle>{!canEdit ? <Badge>Read only</Badge> : null}</CardHeader>
      <CardBody>
        {cfg.isPending ? <Skeleton className="h-9" /> : (
          <div className="max-w-md space-y-2">
            <Field label="When a new lead arrives" htmlFor="assign-rule"><select id="assign-rule" disabled={!canEdit || save.isPending} value={cfg.data?.strategy} onChange={(e) => save.mutate(e.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px]"><option value="manual">Leave unassigned for a manager</option><option value="round_robin">Share equally between sales agents (round robin)</option></select></Field>
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

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your workspace profile, appearance and security." />
      <div className="space-y-6"><BusinessProfile /><Assignment /><Appearance /><Sessions /></div>
    </>
  );
}
