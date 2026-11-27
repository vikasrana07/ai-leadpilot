'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface SlotRescueSettings {
  enabled: boolean;
  maxCandidates: number;
  minTemperature: 'HOT' | 'WARM';
}

interface SlotRescueOfferItem {
  id: string;
  title: string;
  startsAt: string;
  status: 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';
  offeredLeadIds: string[];
  createdAt: string;
}

const TONE: Record<SlotRescueOfferItem['status'], 'primary' | 'success' | 'neutral'> = {
  OPEN: 'primary',
  CLAIMED: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

export function SlotRescueCard() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canManage = can('settings:manage');

  const settings = useQuery({
    queryKey: ['appointments', 'slot-rescue', 'settings'],
    queryFn: () => api<SlotRescueSettings>('/appointments/slot-rescue/settings'),
  });

  const offers = useQuery({
    queryKey: ['appointments', 'slot-rescue', 'offers'],
    queryFn: () => api<SlotRescueOfferItem[]>('/appointments/slot-rescue'),
  });

  const save = useMutation({
    mutationFn: (next: SlotRescueSettings) =>
      api<SlotRescueSettings>('/appointments/slot-rescue/settings', { method: 'PUT', body: next }),
    onSuccess: async () => {
      toast.success('Slot Rescue settings saved');
      await qc.invalidateQueries({ queryKey: ['appointments', 'slot-rescue'] });
    },
    onError: (e) => handleApiError(e),
  });

  if (settings.isPending) return <Skeleton className="h-28" />;
  if (!settings.data) return null;

  const cfg = settings.data;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Self-Healing Calendar (Slot Rescue)
          </CardTitle>
          <p className="text-helper mt-0.5">
            When an upcoming appointment is cancelled, automatically offer the freed slot to top {cfg.minTemperature}/HOT leads.
          </p>
        </div>
        {canManage ? (
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              role="switch"
              checked={cfg.enabled}
              disabled={save.isPending}
              onChange={(e) => save.mutate({ ...cfg, enabled: e.target.checked })}
            />
            {cfg.enabled ? 'On' : 'Off'}
          </label>
        ) : (
          <Badge tone={cfg.enabled ? 'success' : 'neutral'}>{cfg.enabled ? 'On' : 'Off'}</Badge>
        )}
      </CardHeader>
      {offers.data && offers.data.length > 0 ? (
        <CardBody>
          <p className="text-label mb-2 text-muted-foreground">Recent rescued slots</p>
          <ul className="divide-y divide-border text-[13px]">
            {offers.data.slice(0, 5).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{o.title}</p>
                  <p className="text-helper">
                    Offered to {o.offeredLeadIds.length} lead(s) · {timeAgo(o.createdAt)}
                  </p>
                </div>
                <Badge tone={TONE[o.status]}>{o.status}</Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}
    </Card>
  );
}
