'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { ENTITLEMENT_LABELS, FEATURE_KEYS, LIMIT_KEYS, inr, limitText } from '@/lib/billing';
import { platformApi, type PlatformPlan } from '@/lib/platform';

interface Draft { key: string; name: string; description: string; priceRupees: string; trialDays: string; isPublic: boolean; active: boolean; sortOrder: string; ent: Record<string, { enabled: boolean; limit: string }>; isNew: boolean }

const blank = (): Draft => ({ key: '', name: '', description: '', priceRupees: '', trialDays: '14', isPublic: true, active: true, sortOrder: '100', isNew: true, ent: Object.fromEntries([...LIMIT_KEYS, ...FEATURE_KEYS].map((k) => [k, { enabled: true, limit: '' }])) });
const fromPlan = (p: PlatformPlan): Draft => ({ key: p.key, name: p.name, description: p.description, priceRupees: String(p.priceMinor / 100), trialDays: String(p.trialDays), isPublic: p.isPublic, active: p.active, sortOrder: String(p.sortOrder), isNew: false, ent: Object.fromEntries(p.entitlements.map((e) => [e.key, { enabled: e.enabled, limit: e.limit === null ? '' : String(e.limit) }])) });

export default function PlatformPlans() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-plans'], queryFn: () => platformApi<PlatformPlan[]>('/plans') });
  const [d, setD] = useState<Draft | null>(null);
  const save = useMutation({
    mutationFn: (x: Draft) => {
      const body = {
        name: x.name, description: x.description, priceMinor: Math.round(Number(x.priceRupees) * 100), trialDays: Number(x.trialDays || 0), isPublic: x.isPublic, active: x.active, sortOrder: Number(x.sortOrder || 0),
        entitlements: [...LIMIT_KEYS, ...FEATURE_KEYS].map((k) => ({ key: k, enabled: x.ent[k]?.enabled ?? false, limit: (LIMIT_KEYS as readonly string[]).includes(k) && x.ent[k]?.limit !== '' && x.ent[k] ? Number(x.ent[k].limit) : null })),
      };
      return x.isNew ? platformApi('/plans', { method: 'POST', body: { key: x.key, ...body } }) : platformApi(`/plans/${x.key}`, { method: 'PATCH', body });
    },
    onSuccess: () => { toast.success('Plan saved'); setD(null); void qc.invalidateQueries({ queryKey: ['platform-plans'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? (e.details?.[0] ? `${e.details[0].path}: ${e.details[0].message}` : e.message) : 'Could not save'),
  });
  const setEnt = (k: string, patch: Partial<{ enabled: boolean; limit: string }>) => setD((x) => (x ? { ...x, ent: { ...x.ent, [k]: { enabled: true, limit: '', ...x.ent[k], ...patch } } } : x));
  return (
    <>
      <PageHeader title="Plans" description="Plans and limits are data. Limit changes reach existing customers immediately." actions={<Button variant="primary" onClick={() => setD(blank())}>New plan</Button>} />
      {q.isPending ? <Skeleton className="h-48" /> : (
        <div className="grid gap-3 md:grid-cols-2">{q.data?.map((p) => (
          <Card key={p.key}><CardHeader><div><CardTitle>{p.name} <span className="text-helper font-normal">({p.key})</span></CardTitle><p className="text-helper mt-0.5">{inr(p.priceMinor)} + GST = {inr(p.priceWithGstMinor)} · {p.tenants} workspaces · {p.trialDays}-day trial</p></div><div className="flex gap-1.5">{p.active ? null : <Badge tone="danger">Inactive</Badge>}{p.isPublic ? null : <Badge>Hidden</Badge>}</div></CardHeader>
            <CardBody><ul className="mb-3 space-y-1 text-[13px]">{p.entitlements.filter((e) => (LIMIT_KEYS as readonly string[]).includes(e.key)).map((e) => <li key={e.key} className="flex justify-between"><span className="text-muted-foreground">{ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS]}</span><span className="num">{e.enabled ? limitText(e.limit) : 'Off'}</span></li>)}</ul>
              <div className="mb-3 flex flex-wrap gap-1.5">{p.entitlements.filter((e) => (FEATURE_KEYS as readonly string[]).includes(e.key)).map((e) => <Badge key={e.key} tone={e.enabled ? 'success' : 'neutral'}>{ENTITLEMENT_LABELS[e.key as keyof typeof ENTITLEMENT_LABELS]}</Badge>)}</div>
              <Button size="sm" onClick={() => setD(fromPlan(p))}>Edit</Button></CardBody></Card>
        ))}</div>
      )}
      <Dialog open={d !== null} onOpenChange={(o) => { if (!o) setD(null); }}>
        <DialogContent title={d?.isNew ? 'New plan' : `Edit ${d?.name ?? ''}`} description="Price changes only affect new subscribers: existing customers keep the price they signed up at." className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          {d ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(d); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Key" htmlFor="pl-key" hint="lowercase, digits, underscore"><Input id="pl-key" value={d.key} disabled={!d.isNew} onChange={(e) => setD({ ...d, key: e.target.value })} required /></Field>
              <Field label="Name" htmlFor="pl-name"><Input id="pl-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required /></Field>
            </div>
            <Field label="Description" htmlFor="pl-desc"><Input id="pl-desc" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Price ₹ / month (ex-GST)" htmlFor="pl-price"><Input id="pl-price" inputMode="decimal" value={d.priceRupees} onChange={(e) => setD({ ...d, priceRupees: e.target.value })} required /></Field>
              <Field label="Trial days" htmlFor="pl-trial"><Input id="pl-trial" inputMode="numeric" value={d.trialDays} onChange={(e) => setD({ ...d, trialDays: e.target.value })} /></Field>
              <Field label="Sort order" htmlFor="pl-sort"><Input id="pl-sort" inputMode="numeric" value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: e.target.value })} /></Field>
            </div>
            <div className="flex gap-4 text-[13px]"><label className="flex items-center gap-2"><input type="checkbox" checked={d.isPublic} onChange={(e) => setD({ ...d, isPublic: e.target.checked })} />Public (shown on the billing page)</label><label className="flex items-center gap-2"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />Active</label></div>
            <fieldset className="rounded-md border border-border p-3"><legend className="text-label px-1">Limits (empty = unlimited)</legend><div className="grid gap-2 sm:grid-cols-2">{LIMIT_KEYS.map((k) => <div key={k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" aria-label={`${ENTITLEMENT_LABELS[k]} enabled`} checked={d.ent[k]?.enabled ?? false} onChange={(e) => setEnt(k, { enabled: e.target.checked })} /><span className="flex-1">{ENTITLEMENT_LABELS[k]}</span><Input className="h-8 w-28" inputMode="numeric" placeholder="∞" aria-label={`${ENTITLEMENT_LABELS[k]} limit`} value={d.ent[k]?.limit ?? ''} onChange={(e) => setEnt(k, { limit: e.target.value.replace(/\D/g, '') })} /></div>)}</div></fieldset>
            <fieldset className="rounded-md border border-border p-3"><legend className="text-label px-1">Features</legend><div className="grid gap-2 sm:grid-cols-2">{FEATURE_KEYS.map((k) => <label key={k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={d.ent[k]?.enabled ?? false} onChange={(e) => setEnt(k, { enabled: e.target.checked })} />{ENTITLEMENT_LABELS[k]}</label>)}</div></fieldset>
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => setD(null)}>Cancel</Button><Button type="submit" variant="primary" loading={save.isPending}>Save plan</Button></div>
          </form> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
