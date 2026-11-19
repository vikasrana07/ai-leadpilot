'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { TIMELINES } from '@leadpilot/validation';
import type { LeadDto } from '@leadpilot/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CustomFieldInputs, type CustomValues } from '@/components/crm/custom-field-inputs';
import { usePack, useTerms } from '@/lib/pack';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLeadMeta, useMembers, type DuplicateInfo } from '@/lib/crm';
import { TIMELINE_LABELS } from '@/lib/format';
import { handleApiError } from '@/lib/forms';
import { cn } from '@/lib/cn';

const leadFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    phone: z.string().trim().optional(),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .optional()
      .or(z.literal('')),
    budgetMin: z.string().optional(),
    budgetMax: z.string().optional(),
    location: z.string().trim().optional(),
    propertyType: z.string().trim().optional(),
    requirements: z.string().trim().max(4000).optional(),
    buyingTimeline: z.enum(TIMELINES),
    sourceKey: z.string().optional(),
    assignedMembershipId: z.string().optional(),
  })
  .refine((v) => Boolean(v.phone?.trim()) || Boolean(v.email?.trim()), {
    message: 'Provide a phone number or an email',
    path: ['phone'],
  });

type LeadFormValues = z.infer<typeof leadFormSchema>;

const EMPTY_LEAD_FORM: LeadFormValues = {
  name: '',
  phone: '',
  email: '',
  budgetMin: '',
  budgetMax: '',
  location: '',
  propertyType: '',
  requirements: '',
  buyingTimeline: 'UNKNOWN',
  sourceKey: 'manual',
  assignedMembershipId: '',
};

/** Create-lead dialog. A 409 from the API (same phone/email) shows the existing lead(s) and lets the user open or override. */
export function LeadFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (l: LeadDto) => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const meta = useLeadMeta();
  const members = useMembers();
  const lf = usePack().leadFields;
  const terms = useTerms();

  const [cf, setCf] = useState<CustomValues>({});
  const [dupes, setDupes] = useState<DuplicateInfo[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: EMPTY_LEAD_FORM,
  });

  const num = (v?: string) => (!v || v.trim() === '' ? null : Number(v.replace(/,/g, '')));

  async function onSubmit(f: LeadFormValues, allowDuplicate = false) {
    setDupes([]);
    try {
      const body = {
        name: f.name.trim(),
        phone: f.phone?.trim() || null,
        email: f.email?.trim() || null,
        budgetMin: num(f.budgetMin),
        budgetMax: num(f.budgetMax),
        location: f.location?.trim() || null,
        propertyType: f.propertyType?.trim() || null,
        requirements: f.requirements?.trim() || null,
        buyingTimeline: f.buyingTimeline,
        sourceKey: f.sourceKey || 'manual',
        ...(Object.keys(cf).length ? { customFields: cf } : {}),
        ...(f.assignedMembershipId ? { assignedMembershipId: f.assignedMembershipId } : {}),
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      };
      const lead = await api<LeadDto>('/leads', { method: 'POST', body });
      toast.success(`${lead.name} added`);
      await qc.invalidateQueries({ queryKey: ['leads'] });
      await qc.invalidateQueries({ queryKey: ['pipeline'] });
      await qc.invalidateQueries({ queryKey: ['analytics'] });
      reset(EMPTY_LEAD_FORM);
      setCf({});
      setDupes([]);
      onOpenChange(false);
      onCreated?.(lead);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_lead') {
        setDupes(((e as unknown as { details?: DuplicateInfo[] }).details ?? []) as DuplicateInfo[]);
      } else {
        handleApiError(e, setError);
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setDupes([]);
          setCf({});
          reset(EMPTY_LEAD_FORM);
        }
      }}
    >
      <DialogContent
        title={`Add ${terms.lead}`}
        description="Phone or email is required. Duplicates are checked automatically."
        size="xl"
      >
        <form
          onSubmit={handleSubmit((data) => onSubmit(data, false))}
          className="grid gap-3 sm:grid-cols-2"
          noValidate
        >
          <FormErrorAlert errors={errors} className="sm:col-span-2" />

          <Field label="Name *" htmlFor="lf-name" error={errors.name?.message} className="sm:col-span-2">
            <Input id="lf-name" autoFocus {...register('name')} />
          </Field>

          <Field label="Phone" htmlFor="lf-phone" error={errors.phone?.message}>
            <Input
              id="lf-phone"
              inputMode="tel"
              placeholder="98765 43210"
              {...register('phone')}
            />
          </Field>

          <Field label="Email" htmlFor="lf-email" error={errors.email?.message}>
            <Input id="lf-email" type="email" {...register('email')} />
          </Field>

          {lf.budget ? (
            <>
              <Field label={`${lf.budget.label} min (₹)`} htmlFor="lf-bmin" error={errors.budgetMin?.message}>
                <Input id="lf-bmin" inputMode="numeric" placeholder="8500000" {...register('budgetMin')} />
              </Field>
              <Field label={`${lf.budget.label} max (₹)`} htmlFor="lf-bmax" error={errors.budgetMax?.message}>
                <Input id="lf-bmax" inputMode="numeric" placeholder="9500000" {...register('budgetMax')} />
              </Field>
            </>
          ) : null}

          <Field label={lf.location.label} htmlFor="lf-loc" error={errors.location?.message}>
            <Input id="lf-loc" placeholder={lf.location.placeholder} {...register('location')} />
          </Field>

          {lf.interest ? (
            <Field label={lf.interest.label} htmlFor="lf-type" error={errors.propertyType?.message}>
              <Input id="lf-type" placeholder={lf.interest.placeholder} {...register('propertyType')} />
            </Field>
          ) : null}

          {lf.timeline ? (
            <Field label={lf.timeline.label} htmlFor="lf-tl" error={errors.buyingTimeline?.message}>
              <Select id="lf-tl" {...register('buyingTimeline')}>
                {TIMELINES.map((t) => (
                  <option key={t} value={t}>
                    {TIMELINE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Source" htmlFor="lf-src" error={errors.sourceKey?.message}>
            <Select id="lf-src" {...register('sourceKey')}>
              {meta.data?.sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          {can('lead:assign') ? (
            <Field
              label="Assign to"
              htmlFor="lf-as"
              error={errors.assignedMembershipId?.message}
              className="sm:col-span-2"
              hint="Leave empty to use your workspace's assignment rule."
            >
              <Select id="lf-as" {...register('assignedMembershipId')}>
                <option value="">Automatic</option>
                {members.data
                  ?.filter((m) => m.status === 'ACTIVE')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.user.name} ({m.roleName})
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}

          <CustomFieldInputs
            defs={meta.data?.customFields ?? []}
            values={cf}
            onChange={setCf}
            errors={{}}
            idPrefix="lfcf"
          />

          <Field label={lf.requirements.label} htmlFor="lf-req" error={errors.requirements?.message} className="sm:col-span-2">
            <Textarea id="lf-req" {...register('requirements')} />
          </Field>

          {dupes.length ? (
            <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-[13px] sm:col-span-2">
              <p className="font-medium text-warning">This looks like an existing {terms.lead}</p>
              <ul className="mt-1.5 space-y-1">
                {dupes.map((d) => (
                  <li key={d.id}>
                    <Link
                      className="text-primary underline underline-offset-2 hover:no-underline"
                      href={`/leads/${d.id}`}
                      onClick={() => onOpenChange(false)}
                    >
                      {d.name}
                    </Link>{' '}
                    <span className="text-muted-foreground">
                      · {d.phone ?? d.email} · {d.stage}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={cn('flex justify-end gap-2 pt-2 border-t border-border sm:col-span-2')}>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            {dupes.length ? (
              <Button
                type="button"
                loading={isSubmitting}
                onClick={handleSubmit((data) => onSubmit(data, true))}
              >
                Add anyway
              </Button>
            ) : null}
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Add {terms.lead}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
