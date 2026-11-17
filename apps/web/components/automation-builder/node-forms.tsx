'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { actionSchema, branchDataSchema, GRAPH_LIMITS, TRIGGER_TYPES, triggerSchema, waitDataSchema, type AutomationAction, type GraphNode } from '@leadpilot/validation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm, type Control, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useLeadMeta, useMembers, useStages } from '@/lib/crm';
import type { WaTemplate } from '@/lib/inbox';
import { TRIGGER_LABELS } from '@/lib/ops';
import {
  ACTION_DEFAULTS, ACTION_TYPE_LABELS, defaultValue, FIELD_LABELS, OP_LABELS, opsFor, PLACEHOLDERS, splitMinutes, TEMPERATURES, toMinutes, valueKind, WAIT_UNITS,
  type Choice, type ConditionField, type ConditionOp, type WaitUnit,
} from './labels';

/**
 * One form per step type. Each form validates with the SAME zod schema the server uses and applies its changes to the graph as soon as the
 * values are valid (so there is no separate "apply" step); while a value is invalid the previous valid settings stay in the graph and the
 * form says so. Forms are re-mounted per step (key = node id), so react-hook-form's defaults are always that step's saved data.
 */
type Data<T extends GraphNode['type']> = Extract<GraphNode, { type: T }>['data'];

function useLiveForm(schema: z.ZodType, defaults: FieldValues, toData: (v: FieldValues) => unknown, onApply: (data: never) => void) {
  const form = useForm<FieldValues>({ resolver: zodResolver(schema as never) as never, defaultValues: defaults, mode: 'onChange' });
  const [notApplied, setNotApplied] = useState(false);
  const apply = useRef(onApply); const to = useRef(toData);
  useEffect(() => { apply.current = onApply; to.current = toData; });
  useEffect(() => {
    // Fires when the user (or setValue) changes a field; never on mount, so opening a step cannot dirty the automation.
    return form.subscribe({
      formState: { values: true },
      callback: ({ values, name }) => {
        if (!name) return;
        const r = schema.safeParse(to.current(values as FieldValues));
        setNotApplied(!r.success);
        if (r.success) apply.current(r.data as never);
      },
    });
  }, [form, schema]);
  return { form, notApplied, setNotApplied };
}

const err = (form: UseFormReturn<FieldValues>, name: string): string | undefined => {
  const parts = name.split('.'); let cur: unknown = form.formState.errors;
  for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
  const m = (cur as { message?: unknown } | undefined)?.message;
  return typeof m === 'string' ? m : undefined;
};

function NotApplied({ show }: { show: boolean }) {
  return show ? <p role="status" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-warning">These changes are not applied yet: fix the highlighted fields and they apply automatically.</p> : null;
}

function Placeholders({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Insert a placeholder">
      <span className="text-helper">Insert:</span>
      {PLACEHOLDERS.map((p) => <button key={p} type="button" className="min-h-8 rounded border border-border bg-muted px-1.5 font-mono text-[11px] hover:bg-border max-lg:min-h-11" onClick={() => onPick(p)}>{p}</button>)}
    </div>
  );
}
const append = (form: UseFormReturn<FieldValues>, name: string, text: string) => form.setValue(name, `${String(form.getValues(name) ?? '')}${text}`, { shouldDirty: true, shouldValidate: true });

// ----------------------------------------------------------------------------- trigger
export function TriggerForm({ data, onApply }: { data: Data<'trigger'>; onApply: (d: Data<'trigger'>) => void }) {
  const id = useId();
  const num = (v: unknown) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? undefined : Number(v));
  const { form, notApplied } = useLiveForm(triggerSchema, { type: data.type, hoursBefore: data.hoursBefore, days: data.days },
    (v) => ({ type: v.type, ...(v.type === 'appointment.upcoming' ? { hoursBefore: num(v.hoursBefore) } : {}), ...(v.type === 'lead.inactive' ? { days: num(v.days) } : {}) }), onApply as never);
  const type = form.watch('type') as string;
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => e.preventDefault()}>
      <NotApplied show={notApplied} />
      <Field label="What starts this automation?" htmlFor={`${id}-type`}>
        <Select id={`${id}-type`} {...form.register('type')}>{TRIGGER_TYPES.map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t] ?? t}</option>)}</Select>
      </Field>
      {type === 'appointment.upcoming' ? <Field label="Hours before the visit" htmlFor={`${id}-h`} error={err(form, 'hoursBefore')} hint="From 0.25 (15 minutes) to 168 (a week)."><Input id={`${id}-h`} type="number" inputMode="decimal" step="any" min={0.25} max={168} {...form.register('hoursBefore', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })} /></Field> : null}
      {type === 'lead.inactive' ? <Field label="Days without contact" htmlFor={`${id}-d`} error={err(form, 'days')} hint="1 to 90 days."><Input id={`${id}-d`} type="number" inputMode="numeric" min={1} max={90} {...form.register('days', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })} /></Field> : null}
    </form>
  );
}

// ----------------------------------------------------------------------------- action
function StringList({ control, name, label, max, addLabel }: { control: Control<FieldValues>; name: string; label: string; max: number; addLabel: string }) {
  return (
    <Controller control={control} name={name} render={({ field }) => {
      const list: string[] = Array.isArray(field.value) ? field.value : [];
      return (
        <fieldset className="space-y-2">
          <legend className="text-label text-foreground">{label}</legend>
          {list.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`${label} ${i + 1}`} value={v} placeholder={`{{${i + 1}}} e.g. {{lead.firstName}}`} onChange={(e) => field.onChange(list.map((x, j) => (j === i ? e.target.value : x)))} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => field.onChange(list.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
          {list.length < max ? <Button type="button" size="sm" onClick={() => field.onChange([...list, ''])}><Plus className="h-3.5 w-3.5" aria-hidden />{addLabel}</Button> : null}
        </fieldset>
      );
    }} />
  );
}

export function ActionForm({ data, onApply }: { data: Data<'action'>; onApply: (d: Data<'action'>) => void }) {
  const id = useId();
  const members = useMembers(); const stages = useStages();
  const templates = useQuery({ queryKey: ['whatsapp', 'templates'], queryFn: () => api<WaTemplate[]>('/whatsapp/templates'), retry: false });
  const blank = (v: FieldValues) => { const o: Record<string, unknown> = { ...v }; for (const k of ['body']) if (o[k] === '') delete o[k]; return o; };
  const { form, notApplied, setNotApplied } = useLiveForm(actionSchema, data as FieldValues, blank, onApply as never);
  const type = form.watch('type') as AutomationAction['type'];
  const active = (members.data ?? []).filter((m) => m.status === 'ACTIVE');
  const changeType = (t: AutomationAction['type']) => {
    const next = ACTION_DEFAULTS[t]; form.reset(next as FieldValues);
    const r = actionSchema.safeParse(next); setNotApplied(!r.success); if (r.success) onApply(r.data as never);
  };
  const reg = form.register;
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => e.preventDefault()}>
      <NotApplied show={notApplied} />
      <Field label="What should happen?" htmlFor={`${id}-type`}>
        <Select id={`${id}-type`} value={type} onChange={(e) => changeType(e.target.value as AutomationAction['type'])}>{(Object.keys(ACTION_TYPE_LABELS) as AutomationAction['type'][]).map((t) => <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>)}</Select>
      </Field>

      {type === 'send_whatsapp_template' ? <>
        <Field label="WhatsApp template" htmlFor={`${id}-tpl`} error={err(form, 'template')} hint="Templates you registered under Integrations. The customer must have opted in.">
          <Input id={`${id}-tpl`} list={`${id}-tpls`} autoComplete="off" {...reg('template')} />
        </Field>
        <datalist id={`${id}-tpls`}>{(templates.data ?? []).map((t) => <option key={t.id} value={t.name}>{t.bodyPreview}</option>)}</datalist>
        <Field label="Language" htmlFor={`${id}-lang`} error={err(form, 'language')}><Input id={`${id}-lang`} {...reg('language')} /></Field>
        <StringList control={form.control} name="params" label="Template value" max={10} addLabel="Add a value" />
        <p className="text-helper">Values fill the template&apos;s {'{{1}}'}, {'{{2}}'}… in order. You can use placeholders such as {'{{lead.firstName}}'}.</p>
      </> : null}

      {type === 'send_message' ? <>
        <Field label="Message" htmlFor={`${id}-text`} error={err(form, 'text')} hint="Free text only reaches customers who wrote to you in the last 24 hours; otherwise use a template."><Textarea id={`${id}-text`} rows={4} maxLength={1000} {...reg('text')} /></Field>
        <Placeholders onPick={(p) => append(form, 'text', p)} />
      </> : null}

      {type === 'assign_round_robin' ? <p className="text-helper">Gives the lead to the agent with the fewest open leads. Skipped when the lead already has an owner.</p> : null}

      {type === 'assign_to' ? <Field label="Assign to" htmlFor={`${id}-who`} error={err(form, 'membershipId')} hint={members.isError ? 'Could not load your team.' : undefined}>
        <Select id={`${id}-who`} {...reg('membershipId')}><option value="">Choose a person</option>{active.map((m) => <option key={m.id} value={m.id}>{m.user.name} ({m.roleName})</option>)}</Select>
      </Field> : null}

      {type === 'create_task' ? <>
        <Field label="Task title" htmlFor={`${id}-ttl`} error={err(form, 'title')}><Input id={`${id}-ttl`} {...reg('title')} /></Field>
        <Placeholders onPick={(p) => append(form, 'title', p)} />
        <Field label="Due in (hours)" htmlFor={`${id}-due`} error={err(form, 'dueInHours')} hint="0 to 1440 hours (60 days)."><Input id={`${id}-due`} type="number" inputMode="decimal" min={0} max={1440} {...reg('dueInHours', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })} /></Field>
        <Field label="Assigned to" htmlFor={`${id}-asg`} error={err(form, 'assignee')}>
          <Select id={`${id}-asg`} {...reg('assignee')}><option value="lead_owner">The lead&apos;s owner</option>{active.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select>
        </Field>
      </> : null}

      {type === 'notify' ? <>
        <Field label="Who gets the alert?" htmlFor={`${id}-tg`}><Select id={`${id}-tg`} {...reg('target')}><option value="lead_owner">The lead&apos;s owner (managers if no owner)</option><option value="managers">Managers</option></Select></Field>
        <Field label="Alert title" htmlFor={`${id}-nt`} error={err(form, 'title')}><Input id={`${id}-nt`} {...reg('title')} /></Field>
        <Field label="Details (optional)" htmlFor={`${id}-nb`} error={err(form, 'body')}><Textarea id={`${id}-nb`} rows={2} maxLength={500} {...reg('body')} /></Field>
        <Placeholders onPick={(p) => append(form, 'title', p)} />
      </> : null}

      {type === 'change_stage' ? <Field label="Move the lead to" htmlFor={`${id}-st`} error={err(form, 'stageKey')}>
        <Select id={`${id}-st`} {...reg('stageKey')}><option value="">Choose a stage</option>{(stages.data?.stages ?? []).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>
      </Field> : null}

      {type === 'add_tag' ? <Field label="Tag" htmlFor={`${id}-tag`} error={err(form, 'tag')}><Input id={`${id}-tag`} maxLength={40} {...reg('tag')} /></Field> : null}
    </form>
  );
}

// ----------------------------------------------------------------------------- branch (if / otherwise)
const branchFormSchema = branchDataSchema.superRefine((d, ctx) => {
  d.conditions.forEach((c, i) => {
    const f = c.field as ConditionField; const k = valueKind(f);
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['conditions', i, 'value'] });
    if (!opsFor(f).includes(c.op as ConditionOp)) ctx.addIssue({ code: 'custom', message: 'This comparison does not fit this field', path: ['conditions', i, 'op'] });
    else if (k === 'number' && typeof c.value !== 'number') bad('Enter a number');
    else if (k === 'boolean' && typeof c.value !== 'boolean') bad('Choose yes or no');
    else if (c.op === 'in' && (!Array.isArray(c.value) || c.value.length === 0)) bad('Choose at least one value');
    else if (c.op !== 'in' && k !== 'number' && k !== 'boolean' && (typeof c.value !== 'string' || c.value.trim() === '')) bad('Choose or enter a value');
  });
});

function ConditionValue({ control, index, field, op, choices, id, error }: { control: Control<FieldValues>; index: number; field: ConditionField; op: ConditionOp; choices: Choice[]; id: string; error: string | undefined }) {
  const k = valueKind(field);
  return (
    <Controller control={control} name={`conditions.${index}.value`} render={({ field: f }) => {
      const v = f.value;
      if (k === 'number') return <Field label="Value" htmlFor={id} error={error}><Input id={id} type="number" inputMode="decimal" value={typeof v === 'number' ? v : ''} onChange={(e) => f.onChange(e.target.value === '' ? '' : Number(e.target.value))} /></Field>;
      if (k === 'boolean') return <Field label="Value" htmlFor={id} error={error}><Select id={id} value={String(v)} onChange={(e) => f.onChange(e.target.value === 'true')}><option value="true">Yes</option><option value="false">No</option></Select></Field>;
      if (k === 'text') return <Field label="Value" htmlFor={id} error={error} hint="Matches regardless of capital letters."><Input id={id} value={typeof v === 'string' ? v : ''} onChange={(e) => f.onChange(e.target.value)} /></Field>;
      if (op === 'in') {
        const list: string[] = Array.isArray(v) ? v : [];
        return (
          <fieldset aria-describedby={error ? `${id}-err` : undefined}>
            <legend className="text-label mb-1 text-foreground">Any of</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">{choices.map((c) => (
              <label key={c.value} className="flex min-h-9 items-center gap-2 text-[13px] max-lg:min-h-11"><input type="checkbox" className="h-4 w-4" checked={list.includes(c.value)} onChange={(e) => f.onChange(e.target.checked ? [...list, c.value] : list.filter((x) => x !== c.value))} />{c.label}</label>
            ))}</div>
            {error ? <p id={`${id}-err`} role="alert" className="text-helper !text-danger mt-1">{error}</p> : null}
          </fieldset>
        );
      }
      const cur = typeof v === 'string' ? v : '';
      return (
        <Field label="Value" htmlFor={id} error={error}>
          <Select id={id} value={cur} onChange={(e) => f.onChange(e.target.value)}>
            {cur === '' || !choices.some((c) => c.value === cur) ? <option value={cur}>{cur === '' ? 'Choose…' : `${cur} (not found)`}</option> : null}
            {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
      );
    }} />
  );
}

export function BranchForm({ data, onApply }: { data: Data<'branch'>; onApply: (d: Data<'branch'>) => void }) {
  const id = useId();
  const stages = useStages(); const meta = useLeadMeta();
  const { form, notApplied } = useLiveForm(branchFormSchema, { match: data.match, conditions: data.conditions }, (v) => v, onApply as never);
  const { fields, append: add, remove } = useFieldArray({ control: form.control, name: 'conditions' });
  const stageChoices: Choice[] = (stages.data?.stages ?? []).map((s) => ({ value: s.key, label: s.name }));
  const choicesFor = (f: ConditionField): Choice[] => { const k = valueKind(f); return k === 'stage' ? stageChoices : k === 'temperature' ? TEMPERATURES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() })) : k === 'source' ? (meta.data?.sources ?? []).map((s) => ({ value: s.key, label: s.name })) : []; };
  const watched = form.watch('conditions') as { field: ConditionField; op: ConditionOp }[];
  const fieldNames = Object.keys(FIELD_LABELS) as ConditionField[];
  const onField = (i: number, f: ConditionField) => {
    const ops = opsFor(f); const cur = form.getValues(`conditions.${i}.op`) as ConditionOp; const op = ops.includes(cur) ? cur : (ops[0] as ConditionOp);
    form.setValue(`conditions.${i}.field`, f, { shouldDirty: true }); form.setValue(`conditions.${i}.op`, op, { shouldDirty: true });
    form.setValue(`conditions.${i}.value`, defaultValue(f, op, choicesFor(f)), { shouldDirty: true, shouldValidate: true });
  };
  const onOp = (i: number, op: ConditionOp) => {
    const f = form.getValues(`conditions.${i}.field`) as ConditionField; const was = form.getValues(`conditions.${i}.op`) as ConditionOp;
    form.setValue(`conditions.${i}.op`, op, { shouldDirty: true });
    if ((op === 'in') !== (was === 'in')) form.setValue(`conditions.${i}.value`, defaultValue(f, op, choicesFor(f)), { shouldDirty: true });
    void form.trigger(`conditions.${i}.value`);
  };
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => e.preventDefault()}>
      <NotApplied show={notApplied} />
      <p className="text-helper">This step asks a question about the lead. Leads that match follow the <strong>If</strong> path; all others follow <strong>Otherwise</strong>.</p>
      <Field label="The lead must match" htmlFor={`${id}-m`}><Select id={`${id}-m`} {...form.register('match')}><option value="all">All of the conditions</option><option value="any">Any one of the conditions</option></Select></Field>
      {err(form, 'conditions') ? <p role="alert" className="text-helper !text-danger">{err(form, 'conditions')}</p> : null}
      <ol className="space-y-3">
        {fields.map((c, i) => {
          const f = (watched?.[i]?.field ?? 'lead.stage') as ConditionField; const op = (watched?.[i]?.op ?? 'eq') as ConditionOp;
          return (
            <li key={c.id} className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between"><h4 className="text-label">Condition {i + 1}</h4>
                {fields.length > 1 ? <Button type="button" variant="ghost" size="sm" aria-label={`Remove condition ${i + 1}`} onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" aria-hidden />Remove</Button> : null}</div>
              <Field label="About" htmlFor={`${id}-f${i}`}><Select id={`${id}-f${i}`} value={f} onChange={(e) => onField(i, e.target.value as ConditionField)}>{fieldNames.map((n) => <option key={n} value={n}>{FIELD_LABELS[n]}</option>)}</Select></Field>
              <Field label="Comparison" htmlFor={`${id}-o${i}`} error={err(form, `conditions.${i}.op`)}><Select id={`${id}-o${i}`} value={op} onChange={(e) => onOp(i, e.target.value as ConditionOp)}>{opsFor(f).map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}</Select></Field>
              <ConditionValue control={form.control} index={i} field={f} op={op} choices={choicesFor(f)} id={`${id}-v${i}`} error={err(form, `conditions.${i}.value`)} />
            </li>
          );
        })}
      </ol>
      {fields.length < GRAPH_LIMITS.conditionsPerBranch ? <Button type="button" size="sm" onClick={() => add({ field: 'lead.temperature', op: 'eq', value: 'HOT' })}><Plus className="h-3.5 w-3.5" aria-hidden />Add a condition</Button> : null}
    </form>
  );
}

// ----------------------------------------------------------------------------- wait
const waitFormSchema = z.object({
  amount: z.number({ error: 'Enter a number' }).min(1, 'At least 1'),
  unit: z.enum(['minutes', 'hours', 'days']),
}).superRefine((v, ctx) => { if (toMinutes(v.amount, v.unit) > GRAPH_LIMITS.waitMinutes) ctx.addIssue({ code: 'custom', message: 'A wait can be at most 30 days', path: ['amount'] }); if (!Number.isInteger(toMinutes(v.amount, v.unit))) ctx.addIssue({ code: 'custom', message: 'Use whole minutes', path: ['amount'] }); });

export function WaitForm({ data, onApply }: { data: Data<'wait'>; onApply: (d: Data<'wait'>) => void }) {
  const id = useId();
  const { form, notApplied } = useLiveForm(waitFormSchema, splitMinutes(data.minutes), (v) => ({ amount: typeof v.amount === 'number' ? v.amount : Number.NaN, unit: v.unit }),
    ((d: { amount: number; unit: WaitUnit }) => { const r = waitDataSchema.safeParse({ minutes: toMinutes(d.amount, d.unit), exitOnOptOut: true }); if (r.success) onApply(r.data as Data<'wait'>); }) as never);
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => e.preventDefault()}>
      <NotApplied show={notApplied} />
      <div className="flex items-end gap-2">
        <Field label="Wait for" htmlFor={`${id}-a`} error={err(form, 'amount')} className="flex-1"><Input id={`${id}-a`} type="number" inputMode="decimal" min={1} {...form.register('amount', { valueAsNumber: true })} /></Field>
        <Field label="Unit" htmlFor={`${id}-u`}><Select id={`${id}-u`} {...form.register('unit')}>{WAIT_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</Select></Field>
      </div>
      <p className="text-helper">The automation pauses here. If the customer opts out (STOP) it ends. Use the connections below to choose what happens when they reply, and when they do not.</p>
    </form>
  );
}
