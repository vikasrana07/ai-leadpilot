'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarX, CheckSquare, MessageSquare, Phone } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { handleApiError } from '@/lib/forms';
import { usePack } from '@/lib/pack';

export interface NoShowTarget {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone?: string | null;
  serviceType?: string | null;
  title: string;
  startsAt: string;
}

interface NoShowRecoveryDialogProps {
  appointment: NoShowTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function NoShowRecoveryDialog({
  appointment,
  open,
  onOpenChange,
  onSuccess,
}: NoShowRecoveryDialogProps) {
  const pack = usePack();
  const qc = useQueryClient();
  const [createTask, setCreateTask] = useState(true);

  const cleanPhone = appointment?.leadPhone ? appointment.leadPhone.replace(/[^0-9]/g, '') : null;

  // Personalized industry re-engagement message
  const serviceLabel = appointment?.serviceType || 'scheduled appointment';
  let recoveryMessage = `Hi ${appointment?.leadName}, we missed you for our scheduled ${serviceLabel} today. Would you like to reschedule?`;

  if (pack.id === 'healthcare') {
    recoveryMessage = `Hi ${appointment?.leadName}, we missed you for your ${serviceLabel} appointment at our clinic today. Would you like to reschedule? Please let us know what day works best for you.`;
  } else if (pack.id === 'real_estate') {
    recoveryMessage = `Hi ${appointment?.leadName}, sorry we couldn't connect for the ${serviceLabel} today. When would be a convenient time to reschedule?`;
  } else if (pack.id === 'coaching') {
    recoveryMessage = `Hi ${appointment?.leadName}, sorry we missed you for our ${serviceLabel} session today! Let's get you rescheduled so you don't fall behind.`;
  } else if (pack.id === 'home_services') {
    recoveryMessage = `Hi ${appointment?.leadName}, we missed you for your scheduled ${serviceLabel} visit today. Would you like to pick another time?`;
  }

  const markNoShow = useMutation({
    mutationFn: async () => {
      if (!appointment) return;
      // 1. Transition appointment to NO_SHOW
      await api(`/appointments/${appointment.id}/no-show`, { method: 'POST' });

      // 2. Optionally create follow-up task
      if (createTask && appointment.leadId) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);

        try {
          await api('/tasks', {
            method: 'POST',
            body: {
              title: `No-Show Follow-up: ${appointment.leadName}`,
              leadId: appointment.leadId,
              dueAt: tomorrow.toISOString(),
              notes: `Lead missed ${serviceLabel} on ${new Date(appointment.startsAt).toLocaleDateString()}. Re-engagement initiated.`,
            },
          });
        } catch {
          // If task creation fails, appointment status is still updated
        }
      }
    },
    onSuccess: async () => {
      toast.success(createTask ? 'Marked as No-Show & follow-up task created' : 'Marked as No-Show');
      await qc.invalidateQueries({ queryKey: ['appointments'] });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e) => handleApiError(e),
  });

  if (!appointment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Mark as No-Show & Re-engage" size="lg">
        <div className="space-y-4 text-[13px]">
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-foreground flex items-start gap-3">
            <CalendarX className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-[14px]">
                {appointment.leadName} did not attend
              </p>
              <p className="text-muted-foreground mt-0.5">
                Service: <strong>{serviceLabel}</strong> · Slot: {new Date(appointment.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          {/* Quick Communication Box */}
          <div className="rounded-lg border border-border bg-surface p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-primary" aria-hidden />
                Instant WhatsApp Re-engagement
              </span>
              {cleanPhone ? (
                <a
                  href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(recoveryMessage)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                >
                  Open WhatsApp chat &rarr;
                </a>
              ) : (
                <span className="text-helper text-muted-foreground">No phone recorded</span>
              )}
            </div>
            <p className="text-[12px] bg-muted/60 p-2.5 rounded border border-border/60 text-muted-foreground italic">
              "{recoveryMessage}"
            </p>
          </div>

          {/* Task Automation Option */}
          <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={createTask}
              onChange={(e) => setCreateTask(e.target.checked)}
            />
            <div className="text-[13px]">
              <span className="font-medium flex items-center gap-1.5 text-foreground">
                <CheckSquare className="h-3.5 w-3.5 text-primary" aria-hidden />
                Auto-create follow-up callback task
              </span>
              <p className="text-muted-foreground text-[12px] mt-0.5">
                Schedules a task for tomorrow at 10:00 AM assigned to you to try reaching this lead again.
              </p>
            </div>
          </label>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={markNoShow.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={markNoShow.isPending}
              onClick={() => markNoShow.mutate()}
            >
              Confirm No-Show
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
