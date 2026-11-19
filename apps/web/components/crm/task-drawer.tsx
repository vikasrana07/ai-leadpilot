'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, FormErrorAlert } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs, useMembers } from '@/lib/crm';
import { handleApiError } from '@/lib/forms';
import type { TaskItem } from '@/lib/ops';

interface TaskDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskToEdit?: TaskItem | null;
  onSuccess?: () => void;
}

const taskFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Task title is required')
    .max(200, 'Title cannot exceed 200 characters'),
  dueAt: z.string().optional(),
  notes: z.string().trim().max(2000, 'Notes cannot exceed 2000 characters').optional(),
  assigneeMembershipId: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

function toDatetimeLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function TaskDrawer({ open, onOpenChange, taskToEdit, onSuccess }: TaskDrawerProps) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const members = useMembers();

  const [selectedLead, setSelectedLead] = useState<{ id: string; name: string; phone?: string | null } | null>(null);
  const [leadSearchInput, setLeadSearchInput] = useState('');
  const debouncedSearch = useDebounce(leadSearchInput, 250);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: '',
      dueAt: '',
      notes: '',
      assigneeMembershipId: '',
    },
  });

  const dueAtValue = watch('dueAt') ?? '';

  const leadSearch = useQuery({
    queryKey: ['leads', 'picker', debouncedSearch],
    enabled: open && !selectedLead && debouncedSearch.trim().length > 0,
    queryFn: () =>
      api<{ items: { id: string; name: string; phone: string | null }[] }>(
        `/leads${qs({ q: debouncedSearch.trim(), pageSize: 5 })}`,
      ),
  });

  // Populate form when editing or opening fresh
  useEffect(() => {
    if (open) {
      if (taskToEdit) {
        reset({
          title: taskToEdit.title,
          dueAt: toDatetimeLocal(taskToEdit.dueAt),
          notes: taskToEdit.notes ?? '',
          assigneeMembershipId: taskToEdit.assigneeMembershipId ?? '',
        });
        setSelectedLead(
          taskToEdit.leadId ? { id: taskToEdit.leadId, name: taskToEdit.leadName ?? 'Associated Lead' } : null,
        );
      } else {
        reset({
          title: '',
          dueAt: '',
          notes: '',
          assigneeMembershipId: '',
        });
        setSelectedLead(null);
      }
      setLeadSearchInput('');
    }
  }, [open, taskToEdit, reset]);

  const onSubmit = async (values: TaskFormValues) => {
    try {
      const payload = {
        title: values.title.trim(),
        dueAt: values.dueAt ? new Date(values.dueAt).toISOString() : null,
        notes: values.notes?.trim() || null,
        assigneeMembershipId: values.assigneeMembershipId || null,
      };

      if (taskToEdit) {
        await api<TaskItem>(`/tasks/${taskToEdit.id}`, {
          method: 'PATCH',
          body: payload,
        });
      } else {
        await api<TaskItem>('/tasks', {
          method: 'POST',
          body: {
            ...payload,
            leadId: selectedLead?.id || null,
          },
        });
      }

      toast.success(taskToEdit ? 'Task updated' : 'Task created');
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      handleApiError(e, setError);
    }
  };

  const setPresetDue = (type: 'today-5pm' | 'tomorrow-10am' | '2-days' | 'next-mon' | 'clear') => {
    if (type === 'clear') {
      setValue('dueAt', '', { shouldDirty: true, shouldValidate: true });
      return;
    }
    const d = new Date();
    if (type === 'today-5pm') {
      d.setHours(17, 0, 0, 0);
      if (d.getTime() < Date.now()) {
        d.setDate(d.getDate() + 1);
      }
    } else if (type === 'tomorrow-10am') {
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
    } else if (type === '2-days') {
      d.setDate(d.getDate() + 2);
      d.setHours(10, 0, 0, 0);
    } else if (type === 'next-mon') {
      const day = d.getDay();
      const diff = ((1 + 7 - day) % 7) || 7;
      d.setDate(d.getDate() + diff);
      d.setHours(10, 0, 0, 0);
    }
    setValue('dueAt', toDatetimeLocal(d.toISOString()), { shouldDirty: true, shouldValidate: true });
  };

  const activeMembers = (members.data ?? []).filter((m) => m.status === 'ACTIVE');
  const canAssign = can('lead:assign') || can('lead:read:all');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={taskToEdit ? 'Edit Task' : 'New Task'}
        description={
          taskToEdit
            ? 'Update task details, due date, or assignments.'
            : 'Schedule follow-up actions and reminders for your pipeline.'
        }
        size="xl"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="task-drawer-form"
              variant="primary"
              loading={isSubmitting}
            >
              {taskToEdit ? 'Save Changes' : 'Create Task'}
            </Button>
          </>
        }
      >
        <form
          id="task-drawer-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <FormErrorAlert errors={errors} />

          <Field label="Task title *" htmlFor="task-title" error={errors.title?.message}>
            <Input
              id="task-title"
              placeholder="e.g. Call Rahul to review proposal"
              autoFocus
              maxLength={200}
              {...register('title')}
            />
          </Field>

          {/* Lead Association */}
          <div className="space-y-1.5">
            <label className="text-label block text-foreground">Associated Lead</label>
            {selectedLead ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]">
                <div className="flex items-center gap-2 truncate">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <User className="h-3.5 w-3.5" />
                  </div>
                  <span className="truncate font-medium text-foreground">{selectedLead.name}</span>
                  {selectedLead.phone ? (
                    <span className="text-[12px] text-muted-foreground">{selectedLead.phone}</span>
                  ) : null}
                </div>
                {!taskToEdit ? (
                  <button
                    type="button"
                    onClick={() => setSelectedLead(null)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Remove lead"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  id="task-lead-search"
                  placeholder="Search lead by name or phone..."
                  className="pl-8"
                  value={leadSearchInput}
                  onChange={(e) => setLeadSearchInput(e.target.value)}
                />
                {leadSearch.data?.items && leadSearch.data.items.length > 0 ? (
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg divide-y divide-border">
                    {leadSearch.data.items.map((l) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-muted transition-colors"
                          onClick={() => {
                            setSelectedLead(l);
                            setLeadSearchInput('');
                          }}
                        >
                          <span className="font-medium text-foreground">{l.name}</span>
                          {l.phone ? <span className="text-helper text-[12px]">{l.phone}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : leadSearchInput.trim() && !leadSearch.isPending && leadSearch.data?.items.length === 0 ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-border bg-card p-2 text-center text-helper text-[12px]">
                    No leads found
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Due Date & Time */}
          <div className="space-y-1.5">
            <Field label="Due date & time" htmlFor="task-due-date" error={errors.dueAt?.message}>
              <Input
                id="task-due-date"
                type="datetime-local"
                {...register('dueAt')}
              />
            </Field>

            {/* Quick date shortcuts */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setPresetDue('today-5pm')}
                className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground"
              >
                Today 5 PM
              </button>
              <button
                type="button"
                onClick={() => setPresetDue('tomorrow-10am')}
                className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground"
              >
                Tomorrow 10 AM
              </button>
              <button
                type="button"
                onClick={() => setPresetDue('2-days')}
                className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground"
              >
                In 2 Days
              </button>
              <button
                type="button"
                onClick={() => setPresetDue('next-mon')}
                className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground"
              >
                Next Mon
              </button>
              {dueAtValue ? (
                <button
                  type="button"
                  onClick={() => setPresetDue('clear')}
                  className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger-soft"
                >
                  Clear date
                </button>
              ) : null}
            </div>
          </div>

          {/* Assignee Selection */}
          {canAssign ? (
            <Field label="Assign to" htmlFor="task-assignee" error={errors.assigneeMembershipId?.message}>
              <Select
                id="task-assignee"
                {...register('assigneeMembershipId')}
              >
                <option value="">Myself (Default)</option>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name} ({m.roleName})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {/* Notes */}
          <Field label="Notes & Context" htmlFor="task-notes" error={errors.notes?.message}>
            <Textarea
              id="task-notes"
              placeholder="Add key context, requirements, phone notes, or links..."
              rows={3}
              maxLength={2000}
              {...register('notes')}
            />
          </Field>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
