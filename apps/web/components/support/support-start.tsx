'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { handleApiError } from '@/lib/forms';
import { platformApi } from '@/lib/platform';

const supportAccessSchema = z.object({
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters'),
  minutes: z.string(),
  password: z.string().min(1, 'Password is required'),
});

type SupportAccessFormValues = z.infer<typeof supportAccessSchema>;

/** Platform console: open a READ-ONLY support session in a workspace (reason + password required, 30 minutes at most, visible to the customer). */
export function SupportAccessButton({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SupportAccessFormValues>({
    resolver: zodResolver(supportAccessSchema),
    defaultValues: {
      reason: '',
      minutes: '30',
      password: '',
    },
  });

  async function onSubmit(data: SupportAccessFormValues) {
    try {
      const r = await platformApi<{ openUrl: string }>(`/tenants/${tenantId}/support-session`, {
        method: 'POST',
        body: {
          reason: data.reason,
          password: data.password,
          minutes: Number(data.minutes),
        },
      });
      toast.success('Support session started. Opening the workspace (read-only)…');
      window.location.assign(r.openUrl);
    } catch (e) {
      handleApiError(e, setError);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Support access
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent
          title="Start a read-only support session"
          description="You will see this workspace as a read-only member for a limited time. You cannot change anything, and the customer is told who looked and why. Use a separate browser profile: the session replaces any workspace login in this browser."
        >
          <form className="flex flex-1 flex-col justify-between" noValidate onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <FormErrorAlert errors={errors} />
              <Field
                label="Reason (shown to the customer)"
                htmlFor="sp-reason"
                error={errors.reason?.message}
                hint="Minimum 10 characters"
              >
                <Textarea
                  id="sp-reason"
                  rows={3}
                  autoFocus
                  placeholder="e.g. Customer reported leads missing from the list (ticket 1234)"
                  {...register('reason')}
                />
              </Field>
              <Field label="Duration" htmlFor="sp-min" error={errors.minutes?.message}>
                <Select id="sp-min" {...register('minutes')}>
                  <option value="10">10 minutes</option>
                  <option value="20">20 minutes</option>
                  <option value="30">30 minutes (maximum)</option>
                </Select>
              </Field>
              <Field label="Confirm with your password" htmlFor="sp-pw" error={errors.password?.message}>
                <Input
                  id="sp-pw"
                  type="password"
                  autoComplete="current-password"
                  {...register('password')}
                />
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={isSubmitting}>
                Start session
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
