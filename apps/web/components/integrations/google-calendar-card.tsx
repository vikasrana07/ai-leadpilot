'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';
import { useTerms } from '@/lib/pack';

export interface GoogleCalendarStatus {
  mode: 'off' | 'mock' | 'live';
  connected: boolean;
  email: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  status: string | null;
}

export function GoogleCalendarCard() {
  const terms = useTerms();
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['integrations', 'google-calendar'],
    queryFn: () => api<GoogleCalendarStatus>('/integrations/google-calendar'),
  });

  const connectMutation = useMutation({
    mutationFn: ({ code, state }: { code: string; state: string }) =>
      api<{ ok: boolean; email: string }>('/integrations/google-calendar/connect', {
        method: 'POST',
        body: { code, state },
      }),
    onSuccess: async (data) => {
      toast.success(`Google Calendar connected (${data.email})`);
      await qc.invalidateQueries({ queryKey: ['integrations', 'google-calendar'] });
      // Clean query params from URL
      router.replace('/integrations');
    },
    onError: (e) => handleApiError(e),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api('/integrations/google-calendar', { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Google Calendar disconnected');
      await qc.invalidateQueries({ queryKey: ['integrations', 'google-calendar'] });
    },
    onError: (e) => handleApiError(e),
  });

  // Handle OAuth callback if code is in the query params
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code) return;
    // The server only accepts a `state` it issued for this member; a link crafted by someone else will not carry one.
    if (!state) {
      toast.error('This Google sign-in link is not valid. Please start the connection again.');
      router.replace('/integrations');
      return;
    }
    if (!connectMutation.isPending && !connectMutation.isSuccess) {
      connectMutation.mutate({ code, state });
    }
  }, [searchParams]);

  async function handleConnect() {
    setBusy(true);
    try {
      const res = await api<{ url: string | null }>('/integrations/google-calendar/auth-url');
      if (!res.url) {
        toast.error('Could not initiate Google Calendar connection');
        return;
      }
      window.location.assign(res.url);
    } catch (e) {
      handleApiError(e);
    } finally {
      setBusy(false);
    }
  }

  if (statusQuery.isPending) {
    return <Skeleton className="h-28" />;
  }

  const data = statusQuery.data;
  const isConnected = data?.connected ?? false;
  const needsReconnect = data?.status === 'needs_reauth';

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div className="flex-1">
            <CardTitle>Google Calendar</CardTitle>
            <p className="text-helper mt-0.5">
              Checks your availability and adds new {terms.visits} to your Google Calendar.
            </p>
          </div>
          {isConnected ? (
            <Badge tone="success">Connected</Badge>
          ) : needsReconnect ? (
            <Badge tone="warning">Reconnect needed</Badge>
          ) : (
            <Badge tone="neutral">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {isConnected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" aria-hidden />
                  <p className="text-[13px] font-medium">{data?.email ?? 'Google Calendar'}</p>
                </div>
                <p className="text-helper">
                  {data?.lastSyncedAt
                    ? `Last active ${timeAgo(data.lastSyncedAt)}`
                    : 'Sync active'}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={disconnectMutation.isPending}
                onClick={() => disconnectMutation.mutate()}
              >
                Disconnect
              </Button>
            </div>
            <p className="text-[13px] text-muted-foreground">
              New {terms.visits} booked in LeadPilot are added to your Google Calendar automatically. Busy events on your Google Calendar block those times in LeadPilot.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {needsReconnect ? (
              <p className="text-[13px] font-medium text-warning">
                Google stopped accepting the saved sign-in (access was revoked or expired). New {terms.visits} are not being added to your calendar until you reconnect.
              </p>
            ) : null}
            <p className="text-[13px] text-muted-foreground">
              Connect your Google Calendar so LeadPilot can check your real-time availability and push upcoming {terms.visits} directly to your personal schedule.
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                loading={busy || connectMutation.isPending}
                onClick={() => void handleConnect()}
              >
                <CalendarDays className="mr-1.5 h-4 w-4" aria-hidden />
                {needsReconnect ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
