'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Clock, Flame, MessageSquareWarning, Sun } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useI18n } from '@/lib/i18n-context';
import { useTerms } from '@/lib/pack';

interface MorningBriefData {
  topHotLeads: { id: string; name: string; phone: string | null; score: number | null; location: string | null; lastContactedAt: string | null }[];
  openPromises: { id: string; title: string; leadId: string | null; dueAt: string | null; overdue: boolean }[];
  todaysAppointments: { id: string; title: string; leadId: string | null; startsAt: string; status: string }[];
  coolingChats: number;
}

export function MorningBriefCard() {
  const { t } = useI18n();
  const terms = useTerms();
  const brief = useQuery({
    queryKey: ['analytics', 'morning-brief'],
    queryFn: () => api<MorningBriefData>('/analytics/morning-brief'),
  });

  if (brief.isPending) return <Skeleton className="mb-4 h-36 rounded-lg" />;
  if (!brief.data) return null;

  const d = brief.data;
  const empty = d.topHotLeads.length === 0 && d.openPromises.length === 0 && d.todaysAppointments.length === 0 && d.coolingChats === 0;
  if (empty) return null;

  return (
    <Card className="mb-4 border-primary/25 bg-primary/[0.02]" data-testid="morning-brief-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-warning" aria-hidden />
          <CardTitle className="text-[14px]">{t('dashboard.morningBrief')}</CardTitle>
        </div>
        {d.coolingChats > 0 ? (
          <Link href="/inbox" className="inline-flex items-center gap-1 text-[12px] font-medium text-warning hover:underline">
            <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden />
            {d.coolingChats} cooling chat{d.coolingChats === 1 ? '' : 's'}
          </Link>
        ) : null}
      </CardHeader>
      <CardBody className="grid gap-4 pt-1 md:grid-cols-3">
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-danger" aria-hidden />
            Top hot {terms.leads}
          </p>
          {d.topHotLeads.length === 0 ? (
            <p className="text-helper">All caught up.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.topHotLeads.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <Link href={`/leads/${l.id}`} className="truncate font-medium text-foreground hover:underline">
                    {l.name}
                  </Link>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {l.lastContactedAt ? timeAgo(l.lastContactedAt) : 'Not contacted'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-warning" aria-hidden />
            {t('dashboard.openPromises')}
          </p>
          {d.openPromises.length === 0 ? (
            <p className="text-helper">Zero pending promises.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.openPromises.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <Link href={p.leadId ? `/leads/${p.leadId}` : '/tasks'} className="truncate font-medium text-foreground hover:underline">
                    {p.title.replace(/^Promise:\s*/i, '')}
                  </Link>
                  {p.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5 text-primary" aria-hidden />
            Today&apos;s schedule
          </p>
          {d.todaysAppointments.length === 0 ? (
            <p className="text-helper">Nothing booked today.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.todaysAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <Link href="/appointments" className="truncate font-medium text-foreground hover:underline">
                    {a.title}
                  </Link>
                  <span className="num shrink-0 text-[11px] text-muted-foreground">
                    {new Date(a.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
