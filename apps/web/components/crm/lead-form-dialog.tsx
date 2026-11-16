'use client';

import { TIMELINES } from '@leadpilot/validation';
import type { LeadDto } from '@leadpilot/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLeadMeta, useMembers, type DuplicateInfo } from '@/lib/crm';
import { TIMELINE_LABELS } from '@/lib/format';
import { cn } from '@/lib/cn';

interface FormState { name: string; phone: string; email: string; budgetMin: string; budgetMax: string; location: string; propertyType: string; requirements: string; buyingTimeline: string; sourceKey: string; assignedMembershipId: string }
const EMPTY: FormState = { name: '', phone: '', email: '', budgetMin: '', budgetMax: '', location: '', propertyType: '', requirements: '', buyingTimeline: 'UNKNOWN', sourceKey: 'manual', assignedMembershipId: '' };

/** Create-lead dialog. A 409 from the API (same phone/email) shows the existing lead(s) and lets the user open or override. */
export function LeadFormDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (l: LeadDto) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const meta = useLeadMeta();
  const members = useMembers();
  const [f, setF] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<DuplicateInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));

  async function submit(allowDuplicate: boolean) {
    setBusy(true); setErrors({});
    try {
      const body = { name: f.name, phone: f.phone || null, email: f.email || null, budgetMin: num(f.budgetMin), budgetMax: num(f.budgetMax), location: f.location || null, propertyType: f.propertyType || null, requirements: f.requirements || null, buyingTimeline: f.buyingTimeline, sourceKey: f.sourceKey, ...(f.assignedMembershipId ? { assignedMembershipId: f.assignedMembershipId } : {}), ...(allowDuplicate ? { allowDuplicate: true } : {}) };
      const lead = await api<LeadDto>('/leads', { method: 'POST', body });
      toast.success(`${lead.name} added`);
      await qc.invalidateQueries({ queryKey: ['leads'] }); await qc.invalidateQueries({ queryKey: ['pipeline'] }); await qc.invalidateQueries({ queryKey: ['analytics'] });
      setF(EMPTY); setDupes([]); onOpenChange(false); onCreated?.(lead);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_lead') setDupes(((e as unknown as { details?: DuplicateInfo[] }).details ?? []) as DuplicateInfo[]);
      else if (e instanceof ApiError && e.details) setErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
      else toast.error(e instanceof ApiError ? e.message : 'Could not add the lead');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setDupes([]); }}>
      <DialogContent title="Add lead" description="Phone or email is required. Duplicates are checked automatically." className="max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); void submit(false); }} className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2" noValidate>
          <Field label="Name" htmlFor="lf-name" error={errors.name} className="sm:col-span-2"><Input id="lf-name" autoFocus value={f.name} onChange={set('name')} aria-invalid={!!errors.name} /></Field>
          <Field label="Phone" htmlFor="lf-phone" error={errors.phone}><Input id="lf-phone" inputMode="tel" placeholder="98765 43210" value={f.phone} onChange={set('phone')} aria-invalid={!!errors.phone} /></Field>
          <Field label="Email" htmlFor="lf-email" error={errors.email}><Input id="lf-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Budget min (₹)" htmlFor="lf-bmin" error={errors.budgetMin}><Input id="lf-bmin" inputMode="numeric" placeholder="8500000" value={f.budgetMin} onChange={set('budgetMin')} /></Field>
          <Field label="Budget max (₹)" htmlFor="lf-bmax" error={errors.budgetMax}><Input id="lf-bmax" inputMode="numeric" placeholder="9500000" value={f.budgetMax} onChange={set('budgetMax')} /></Field>
          <Field label="Preferred location" htmlFor="lf-loc"><Input id="lf-loc" value={f.location} onChange={set('location')} /></Field>
          <Field label="Property type" htmlFor="lf-type"><Input id="lf-type" placeholder="3 BHK apartment" value={f.propertyType} onChange={set('propertyType')} /></Field>
          <Field label="Buying timeline" htmlFor="lf-tl"><Select id="lf-tl" value={f.buyingTimeline} onChange={set('buyingTimeline')}>{TIMELINES.map((t) => <option key={t} value={t}>{TIMELINE_LABELS[t]}</option>)}</Select></Field>
          <Field label="Source" htmlFor="lf-src"><Select id="lf-src" value={f.sourceKey} onChange={set('sourceKey')}>{meta.data?.sources.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select></Field>
          {can('lead:assign') ? (
            <Field label="Assign to" htmlFor="lf-as" className="sm:col-span-2" hint="Leave empty to use your workspace's assignment rule.">
              <Select id="lf-as" value={f.assignedMembershipId} onChange={set('assignedMembershipId')}><option value="">Automatic</option>{members.data?.filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.user.name} ({m.roleName})</option>)}</Select>
            </Field>
          ) : null}
          <Field label="Requirements" htmlFor="lf-req" className="sm:col-span-2"><Textarea id="lf-req" value={f.requirements} onChange={set('requirements')} /></Field>

          {dupes.length ? (
            <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-[13px] sm:col-span-2">
              <p className="font-medium text-warning">This looks like an existing lead</p>
              <ul className="mt-1.5 space-y-1">{dupes.map((d) => <li key={d.id}><Link className="text-primary underline underline-offset-2 hover:no-underline" href={`/leads/${d.id}`} onClick={() => onOpenChange(false)}>{d.name}</Link> <span className="text-muted-foreground">· {d.phone ?? d.email} · {d.stage}</span></li>)}</ul>
            </div>
          ) : null}
          <div className={cn('flex justify-end gap-2 pt-1 sm:col-span-2')}>
            <Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            {dupes.length ? <Button type="button" loading={busy} onClick={() => void submit(true)}>Add anyway</Button> : null}
            <Button type="submit" variant="primary" loading={busy}>Add lead</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
