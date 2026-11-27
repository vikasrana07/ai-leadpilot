'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarCheck2, Clock, MapPin, Sparkles, XCircle } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';

interface PublicClaimOffer {
  businessName: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  expired: boolean;
}

export default function ClaimSlotPage() {
  const { token } = useParams<{ token: string }>();
  const params = useSearchParams();
  const leadId = params.get('l') ?? '';
  const [claimedAt, setClaimedAt] = useState<string | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const offer = useQuery({
    queryKey: ['portal', 'claim', token],
    queryFn: () => api<PublicClaimOffer>(`/portal/claim/${token}`),
    retry: false,
  });

  const claim = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; appointmentId: string; startsAt: string }>(`/portal/claim/${token}`, {
        method: 'POST',
        body: { leadId },
      }),
    onSuccess: (res) => {
      setClaimedAt(res.startsAt);
    },
    onError: (err) => {
      if (err instanceof ApiError) setConflictMsg(err.message);
      else setConflictMsg('Could not claim this slot. It may have just been taken.');
    },
  });

  if (offer.isPending) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (offer.isError || !offer.data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
        <XCircle className="h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="text-title mt-3">Offer unavailable</h1>
        <p className="text-helper mt-1">This priority slot link is invalid or has expired.</p>
      </div>
    );
  }

  const o = offer.data;
  const dt = new Date(o.startsAt);
  const dateStr = dt.toLocaleDateString('en-IN', {
    timeZone: o.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = dt.toLocaleTimeString('en-IN', {
    timeZone: o.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <p className="text-label flex items-center gap-1.5 text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Priority slot opened
          </p>
          <CardTitle className="text-lg">{o.businessName}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {claimedAt ? (
            <div className="space-y-2 rounded-lg border border-success/30 bg-success-soft p-4 text-[13px]">
              <p className="flex items-center gap-2 font-semibold text-success">
                <CalendarCheck2 className="h-4 w-4" aria-hidden />
                Your slot is confirmed!
              </p>
              <p className="text-foreground">
                {o.title} on <strong>{dateStr}</strong> at <strong>{timeStr}</strong>.
              </p>
            </div>
          ) : o.expired || conflictMsg ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4 text-[13px]">
              <Badge tone="neutral">No longer available</Badge>
              <p className="text-muted-foreground">
                {conflictMsg ?? 'This slot has already been claimed by another guest or expired.'}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-[13px]">
                <p className="text-[14px] font-medium">{o.title}</p>
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {dateStr} · {timeStr}
                </p>
                {o.location ? (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {o.location}
                  </p>
                ) : null}
              </div>
              <Button
                variant="primary"
                className="w-full"
                loading={claim.isPending}
                disabled={!leadId}
                onClick={() => claim.mutate()}
              >
                Confirm this slot
              </Button>
              {!leadId ? (
                <p className="text-helper text-center">Open the full link from your invitation message to claim this slot.</p>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
