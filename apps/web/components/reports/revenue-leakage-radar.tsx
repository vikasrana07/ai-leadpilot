'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface RevenueLeakageData {
  currency: string;
  leaking: {
    staleHotLeads: number;
    staleHotBudgetMinor: number;
    unansweredConversations: number;
    overduePromises: number;
    noShowAppointments: number;
  };
  recovered: {
    slotRescuesFilled: number;
    voiceNotesApplied: number;
    adminMinutesSaved: number;
    promisesCaptured: number;
    promisesFulfilled: number;
    aiAssistedTurns: number;
  };
}

function formatMinor(minor: number, currency: string): string {
  const major = Math.round(minor / 100);
  if (major <= 0) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString('en-IN')}`;
  }
}

export function RevenueLeakageRadar({ query, enabled }: { query: string; enabled: boolean }) {
  const radar = useQuery({
    queryKey: ['analytics', 'revenue-leakage', query],
    enabled,
    queryFn: () => api<RevenueLeakageData>(`/analytics/revenue-leakage?${query}`),
  });

  if (!enabled) return null;
  if (radar.isPending) {
    return (
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
      </div>
    );
  }
  if (!radar.data) return null;

  const { leaking, recovered, currency } = radar.data;

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2" data-testid="revenue-leakage-radar">
      <Card className="border-warning/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            Revenue Leakage Radar (At Risk)
          </CardTitle>
          {leaking.staleHotBudgetMinor > 0 ? (
            <span className="num text-[12px] font-semibold text-danger">
              {formatMinor(leaking.staleHotBudgetMinor, currency)} pipeline untouched &gt;48h
            </span>
          ) : null}
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-muted-foreground">Stale hot leads</p>
            <p className="num text-[20px] font-semibold">{leaking.staleHotLeads}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Unanswered &gt;2h</p>
            <p className="num text-[20px] font-semibold">{leaking.unansweredConversations}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Overdue promises</p>
            <p className="num text-[20px] font-semibold text-danger">{leaking.overduePromises}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">No-shows</p>
            <p className="num text-[20px] font-semibold">{leaking.noShowAppointments}</p>
          </div>
        </CardBody>
      </Card>

      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            Value Protected by LeadPilot
          </CardTitle>
          <span className="num text-[12px] font-medium text-primary">
            {recovered.adminMinutesSaved} min CRM admin saved
          </span>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-muted-foreground">Slots rescued</p>
            <p className="num text-[20px] font-semibold">{recovered.slotRescuesFilled}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Voice updates</p>
            <p className="num text-[20px] font-semibold">{recovered.voiceNotesApplied}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Promises kept</p>
            <p className="num text-[20px] font-semibold">
              {recovered.promisesFulfilled}/{recovered.promisesCaptured}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">AI turns</p>
            <p className="num text-[20px] font-semibold">{recovered.aiAssistedTurns}</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
