'use client';

import { CalendarDays, ChevronDown, Flame, MessageCircle, Phone, Plus } from 'lucide-react';
import { PreviewFrame } from '@/components/design/preview-frame';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { cn } from '@/lib/cn';

const KPIS = [
  { label: 'Total leads', value: 1284, deltaPct: 12, trend: [30, 34, 31, 40, 38, 46, 52, 49, 58] },
  { label: 'New leads', value: 214, deltaPct: 8, trend: [20, 26, 22, 30, 28, 34, 33, 40, 44] },
  { label: 'Qualified leads', value: 342, deltaPct: 16, trend: [10, 14, 13, 18, 22, 21, 27, 30, 33] },
  { label: 'Hot leads', value: 61, deltaPct: -6, trend: [30, 28, 33, 29, 25, 27, 22, 24, 20] },
  { label: 'Appointments booked', value: 96, deltaPct: 22, trend: [8, 12, 11, 15, 14, 19, 21, 24, 27] },
  { label: 'Conversion rate', value: 7.4, deltaPct: 4, suffix: '%', trend: [5, 5.4, 5.2, 6, 6.2, 6.1, 6.8, 7, 7.4] },
];
const HOT = [
  { name: 'Vikram Desai', note: 'Asked for a Saturday site visit', score: 82, wait: '2m' },
  { name: 'Karan Malhotra', note: 'Negotiation stalled for 3 days', score: 91, wait: '3d' },
  { name: 'Rohit Sharma', note: 'Wants a call about the home loan', score: 71, wait: '1h' },
];
const TODAY = [
  { t: 'Site visit · Greenfield Heights', who: 'Vikram Desai', time: '11:00 – 12:00', tone: 'border-l-primary' },
  { t: 'Follow-up call', who: 'Anita Kapoor', time: '14:30 – 14:45', tone: 'border-l-warning' },
  { t: 'Site visit · Lakeview Residency', who: 'Neha Joshi', time: '17:00 – 18:00', tone: 'border-l-success' },
];
const AGENTS = [['Sneha Kulkarni', 38, 11, '4m'], ['Rahul Mehta', 29, 8, '7m'], ['Priya Nair', 24, 6, '12m']] as const;

export default function DashboardDesign() {
  return (
    <PreviewFrame active="/design/dashboard">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-6 sm:px-8 xl:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h1 className="text-title">Good morning, Priya</h1><p className="text-helper mt-1 !text-[13px]">Skyline Realty · 3 hot leads need you right now</p></div>
              <div className="flex gap-2"><Button><CalendarDays className="h-4 w-4" aria-hidden />Last 30 days<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button><Button variant="primary"><Plus className="h-4 w-4" aria-hidden />Add lead</Button></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{KPIS.map((k) => <KpiCard key={k.label} {...k} goodWhen="up" />)}</div>

            <Card>
              <CardHeader><CardTitle><Flame className="mr-1.5 inline h-4 w-4 text-danger" aria-hidden />Hot leads needing attention</CardTitle><Button variant="link">View all</Button></CardHeader>
              <ul className="divide-y divide-border">
                {HOT.map((h) => (
                  <li key={h.name} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={h.name} size={34} />
                    <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{h.name}</p><p className="text-helper truncate">{h.note}</p></div>
                    <Badge tone="danger" className="num">{h.score}</Badge><span className="text-helper num w-8 text-right">{h.wait}</span>
                    <Button size="sm" variant="secondary"><MessageCircle className="h-3.5 w-3.5" aria-hidden />Reply</Button><Button size="sm" variant="ghost" aria-label={`Call ${h.name}`}><Phone className="h-3.5 w-3.5" /></Button>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader><CardTitle>Agent performance</CardTitle></CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]"><thead className="bg-muted/50 text-label text-muted-foreground"><tr><th className="px-5 py-2.5 font-medium">Agent</th><th className="px-5 py-2.5 text-right font-medium">Leads</th><th className="px-5 py-2.5 text-right font-medium">Visits</th><th className="px-5 py-2.5 text-right font-medium">Avg. response</th></tr></thead>
                  <tbody className="divide-y divide-border">{AGENTS.map(([n, l, v, r]) => <tr key={n} className="hover:bg-muted/40"><td className="px-5 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={n} size={24} />{n}</span></td><td className="num px-5 py-2.5 text-right">{l}</td><td className="num px-5 py-2.5 text-right">{v}</td><td className="num px-5 py-2.5 text-right">{r}</td></tr>)}</tbody></table>
              </div>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Today</CardTitle><span className="text-helper">Monday</span></CardHeader>
              <ul className="space-y-2 p-3">{TODAY.map((a) => <li key={a.t} className={cn('rounded-md border-l-[3px] bg-muted/50 px-3 py-2.5', a.tone)}><p className="text-[13px] font-medium">{a.t}</p><p className="text-helper num">{a.who} · {a.time}</p></li>)}</ul>
            </Card>
            <Card>
              <CardHeader><CardTitle>AI assistant</CardTitle><Badge tone="success">Live</Badge></CardHeader>
              <dl className="space-y-3 p-5 text-[13px]">{[['Conversations handled', '412'], ['Resolved without a human', '78%'], ['Handovers to your team', '23'], ['Avg. first reply', '6s']].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd className="num font-semibold">{v}</dd></div>)}</dl>
            </Card>
          </aside>
        </div>
      </div>
    </PreviewFrame>
  );
}
