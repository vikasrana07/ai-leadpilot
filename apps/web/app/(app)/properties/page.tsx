'use client';

import { PROPERTY_STATUSES } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ImportDialog } from '@/components/crm/import-dialog';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs } from '@/lib/crm';
import { formatINR } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface Property { id: string; project: string; unitLabel: string | null; title: string; propertyType: string; bedrooms: number | null; areaSqft: number | null; price: number; location: string; status: 'AVAILABLE' | 'HELD' | 'SOLD' }
const TONE = { AVAILABLE: 'success', HELD: 'warning', SOLD: 'neutral' } as const;
const BLANK = { project: '', unitLabel: '', title: '', propertyType: 'Apartment', bedrooms: '', areaSqft: '', price: '', location: '', status: 'AVAILABLE' };

function PropertyDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (o: boolean) => void; existing: Property | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState(existing ? { project: existing.project, unitLabel: existing.unitLabel ?? '', title: existing.title, propertyType: existing.propertyType, bedrooms: existing.bedrooms?.toString() ?? '', areaSqft: existing.areaSqft?.toString() ?? '', price: existing.price.toString(), location: existing.location, status: existing.status as string } : BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    setBusy(true); setErrors({});
    const body = { project: f.project, unitLabel: f.unitLabel || null, title: f.title || `${f.project} ${f.unitLabel}`.trim(), propertyType: f.propertyType, bedrooms: f.bedrooms ? Number(f.bedrooms) : null, areaSqft: f.areaSqft ? Number(f.areaSqft) : null, price: Number(f.price.replace(/,/g, '')), location: f.location, status: f.status };
    try { await api(existing ? `/properties/${existing.id}` : '/properties', { method: existing ? 'PATCH' : 'POST', body }); toast.success(existing ? 'Property updated' : 'Property added'); await qc.invalidateQueries({ queryKey: ['properties'] }); onOpenChange(false); }
    catch (e) { if (e instanceof ApiError && e.details) setErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message]))); else handleApiError(e); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={existing ? 'Edit property' : 'Add property'} className="max-w-xl">
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <Field label="Project" htmlFor="p-project" error={errors.project}><Input id="p-project" autoFocus value={f.project} onChange={set('project')} /></Field>
          <Field label="Unit" htmlFor="p-unit"><Input id="p-unit" placeholder="A-1204" value={f.unitLabel} onChange={set('unitLabel')} /></Field>
          <Field label="Title" htmlFor="p-title" error={errors.title} className="sm:col-span-2" hint="Defaults to project and unit."><Input id="p-title" value={f.title} onChange={set('title')} /></Field>
          <Field label="Type" htmlFor="p-type" error={errors.propertyType}><Input id="p-type" value={f.propertyType} onChange={set('propertyType')} /></Field>
          <Field label="Location" htmlFor="p-loc" error={errors.location}><Input id="p-loc" value={f.location} onChange={set('location')} /></Field>
          <Field label="Bedrooms" htmlFor="p-bhk"><Input id="p-bhk" inputMode="numeric" value={f.bedrooms} onChange={set('bedrooms')} /></Field>
          <Field label="Area (sq ft)" htmlFor="p-area"><Input id="p-area" inputMode="numeric" value={f.areaSqft} onChange={set('areaSqft')} /></Field>
          <Field label="Price (₹)" htmlFor="p-price" error={errors.price}><Input id="p-price" inputMode="numeric" placeholder="11200000" value={f.price} onChange={set('price')} /></Field>
          <Field label="Status" htmlFor="p-status"><Select id="p-status" value={f.status} onChange={set('status')}>{PROPERTY_STATUSES.map((s) => <option key={s} value={s}>{s[0]}{s.slice(1).toLowerCase()}</option>)}</Select></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{existing ? 'Save changes' : 'Add property'}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

export default function PropertiesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('property:manage');
  const [search, setSearch] = useState(''); const q = useDebounce(search, 300);
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Property | 'new' | null>(null); const [importOpen, setImportOpen] = useState(false); const [del, setDel] = useState<Property | null>(null);
  const list = useQuery({ queryKey: ['properties', q, status, page], queryFn: () => api<{ items: Property[]; total: number }>(`/properties${qs({ q, status, page, pageSize: 25 })}`), placeholderData: (p) => p });
  const setStatusM = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/properties/${v.id}`, { method: 'PATCH', body: { status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }), onError: (e) => handleApiError(e) });

  return (
    <>
      <PageHeader title="Properties" description="Your inventory. The AI assistant quotes prices and availability from here, never from guesswork." actions={manage ? <><Button onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" aria-hidden />Import</Button><Button variant="primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" aria-hidden />Add property</Button></> : undefined} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /><Input aria-label="Search properties" placeholder="Search project, title, location" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
          <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{PROPERTY_STATUSES.map((s) => <option key={s} value={s}>{s[0]}{s.slice(1).toLowerCase()}</option>)}</Select>
        </div>
        {list.isPending ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}</div> : list.isError ? <EmptyState icon={Building2} title="Could not load properties" description="Please try again." action={<Button onClick={() => void list.refetch()}>Retry</Button>} /> : list.data.items.length === 0 ? (
          <EmptyState icon={Building2} title={q || status ? 'No properties match' : 'No properties yet'} description={q || status ? 'Try a different search or status.' : 'Add units one by one or import your inventory from a CSV.'} action={manage && !q && !status ? <Button variant="primary" onClick={() => setEdit('new')}>Add property</Button> : undefined} />
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="bg-muted/50 text-label text-muted-foreground"><tr><th className="px-4 py-2.5 font-medium">Property</th><th className="px-4 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 font-medium">Location</th><th className="px-4 py-2.5 text-right font-medium">Area</th><th className="px-4 py-2.5 text-right font-medium">Price</th><th className="px-4 py-2.5 font-medium">Status</th>{manage ? <th className="w-20" /> : null}</tr></thead>
            <tbody className="divide-y divide-border">{list.data.items.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <td className="px-4 py-2"><span className="font-medium">{p.title}</span><span className="text-helper block">{p.project}{p.unitLabel ? ` · ${p.unitLabel}` : ''}</span></td>
                <td className="px-4 py-2">{p.bedrooms ? `${p.bedrooms} BHK ` : ''}{p.propertyType}</td><td className="px-4 py-2">{p.location}</td>
                <td className="num px-4 py-2 text-right">{p.areaSqft ? `${p.areaSqft.toLocaleString('en-IN')} sq ft` : '—'}</td><td className="num px-4 py-2 text-right font-medium">{formatINR(p.price)}</td>
                <td className="px-4 py-2">{manage ? <Select aria-label={`Status of ${p.title}`} className="h-7 w-auto text-[12px]" value={p.status} onChange={(e) => setStatusM.mutate({ id: p.id, status: e.target.value })}>{PROPERTY_STATUSES.map((s) => <option key={s} value={s}>{s[0]}{s.slice(1).toLowerCase()}</option>)}</Select> : <Badge tone={TONE[p.status]}>{p.status[0]}{p.status.slice(1).toLowerCase()}</Badge>}</td>
                {manage ? <td className="px-2 py-2 text-right"><Button variant="ghost" size="icon" aria-label={`Edit ${p.title}`} onClick={() => setEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" aria-label={`Delete ${p.title}`} onClick={() => setDel(p)}><Trash2 className="h-3.5 w-3.5" /></Button></td> : null}
              </tr>))}</tbody>
          </table></div>
        )}
        {list.data && list.data.total > 0 ? <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} /> : null}
      </Card>
      {edit !== null ? <PropertyDialog key={edit === 'new' ? 'new' : edit.id} open onOpenChange={(o) => { if (!o) setEdit(null); }} existing={edit === 'new' ? null : edit} /> : null}
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} endpoint="/properties/import" title="Import properties" hint="CSV columns: project, unit, bhk, area, price, location, status. Prices like 85 L or 1.2 Cr work." invalidate={[['properties']]} />
      <ConfirmDialog open={del !== null} onOpenChange={(o) => { if (!o) setDel(null); }} danger title={`Delete ${del?.title ?? 'property'}?`} description="It will no longer be offered to customers." confirmLabel="Delete" onConfirm={async () => { if (!del) return; try { await api(`/properties/${del.id}`, { method: 'DELETE' }); toast.success('Property deleted'); await qc.invalidateQueries({ queryKey: ['properties'] }); } catch (e) { handleApiError(e); throw e; } }} />
    </>
  );
}
