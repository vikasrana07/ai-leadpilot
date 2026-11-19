'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Download, ShieldAlert, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/dropdown';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';
import { useTerms } from '@/lib/pack';

const eraseLeadSchema = z
  .object({
    reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
    confirm: z.string(),
  })
  .refine((val) => val.confirm === 'ERASE', {
    message: 'Type ERASE to confirm',
    path: ['confirm'],
  });

type EraseLeadFormValues = z.infer<typeof eraseLeadSchema>;

/** Data-principal rights for one lead: download everything held about them, or erase it permanently. */
export function LeadPrivacyMenu({ leadId, leadName }: { leadId: string; leadName: string }) {
  const terms = useTerms();
  const { can } = useAuth();
  const router = useRouter();
  const [eraseOpen, setEraseOpen] = useState(false);
  const canExport = can('lead:export') && can('lead:read:all');
  const canErase = can('lead:delete') && can('lead:read:all');

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EraseLeadFormValues>({
    resolver: zodResolver(eraseLeadSchema),
    defaultValues: { reason: '', confirm: '' },
  });

  const exportData = useMutation({
    mutationFn: () => api<unknown>(`/privacy/leads/${leadId}/export`),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `lead-${leadId.slice(0, 8)}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    },
    onError: (e) => handleApiError(e),
  });

  async function onSubmit(data: EraseLeadFormValues) {
    try {
      await api<{ counts: Record<string, number> }>(`/privacy/leads/${leadId}/erase`, {
        method: 'POST',
        body: { reason: data.reason, confirm: 'ERASE' },
      });
      toast.success('All data about this person was permanently erased');
      setEraseOpen(false);
      reset();
      router.replace('/leads');
    } catch (e) {
      handleApiError(e, setError);
    }
  }

  if (!canExport && !canErase) return null;

  return (
    <>
      <Dropdown trigger={<Button aria-label="Privacy actions"><ShieldAlert className="h-4 w-4" aria-hidden />Privacy</Button>}>
        <DropdownLabel>Data principal requests</DropdownLabel>
        {canExport ? (
          <DropdownItem onSelect={() => exportData.mutate()}>
            <Download className="h-4 w-4" aria-hidden />Export data (JSON)
          </DropdownItem>
        ) : null}
        {canErase ? (
          <DropdownItem
            danger
            onSelect={() => {
              reset();
              setEraseOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />Erase permanently…
          </DropdownItem>
        ) : null}
      </Dropdown>
      <Dialog
        open={eraseOpen}
        onOpenChange={(o) => {
          setEraseOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent title={`Erase ${leadName} permanently?`} description="This cannot be undone.">
          <form className="flex flex-1 flex-col justify-between" noValidate onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-3.5 text-[13px]">
              <FormErrorAlert errors={errors} />
              <p className="text-muted-foreground">
                This deletes the {terms.lead} and everything linked to them: conversations and messages, notes, activity, appointments, tasks, consent records, scores and stored provider payloads that mention their phone number. Only a record that an erasure happened (who, when, why) is kept in the audit log.
              </p>
              <Field
                label="Why are you erasing this data?"
                htmlFor="erase-reason"
                error={errors.reason?.message}
                hint="e.g. customer request ticket reference (min 5 chars)"
              >
                <Input id="erase-reason" autoFocus {...register('reason')} />
              </Field>
              <Field
                label="Type ERASE to confirm"
                htmlFor="erase-confirm"
                error={errors.confirm?.message}
              >
                <Input id="erase-confirm" autoComplete="off" placeholder="ERASE" {...register('confirm')} />
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" onClick={() => { setEraseOpen(false); reset(); }}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={isSubmitting}>
                Erase permanently
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
