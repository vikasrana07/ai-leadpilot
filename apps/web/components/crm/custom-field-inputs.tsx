'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { LeadMeta } from '@/lib/crm';

export type CustomValues = Record<string, string | number | boolean>;

/** The workspace's custom lead fields (seeded from its industry pack, editable by the tenant) as form inputs. */
export function CustomFieldInputs({ defs, values, onChange, errors = {}, idPrefix = 'cf' }: { defs: LeadMeta['customFields']; values: CustomValues; onChange: (next: CustomValues) => void; errors?: Record<string, string>; idPrefix?: string }) {
  const set = (key: string, v: string | number | boolean | undefined) => {
    const next = { ...values };
    if (v === undefined || v === '') delete next[key]; else next[key] = v;
    onChange(next);
  };
  return (
    <>
      {defs.map((d) => (
        <Field key={d.key} label={d.label} htmlFor={`${idPrefix}-${d.key}`} error={errors[`customFields.${d.key}`]}>
          {d.type === 'select' ? <Select id={`${idPrefix}-${d.key}`} value={String(values[d.key] ?? '')} onChange={(e) => set(d.key, e.target.value)}><option value="">—</option>{d.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
            : d.type === 'boolean' ? <Select id={`${idPrefix}-${d.key}`} value={values[d.key] === undefined ? '' : String(values[d.key])} onChange={(e) => set(d.key, e.target.value === '' ? undefined : e.target.value === 'true')}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></Select>
            : <Input id={`${idPrefix}-${d.key}`} type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'} value={String(values[d.key] ?? '')} onChange={(e) => set(d.key, d.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />}
        </Field>
      ))}
    </>
  );
}
