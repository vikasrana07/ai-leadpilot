'use client';

import { CalendarDays, FileText, Mail, MapPin, MessageCircle, Phone, StickyNote, Wallet } from 'lucide-react';
import { useState } from 'react';
import { PreviewFrame } from '@/components/design/preview-frame';
import { ScoreRing } from '@/components/design/score-ring';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/cn';

const TIMELINE = [
  { icon: MessageCircle, title: 'Asked about 3BHK availability', meta: 'WhatsApp · AI assistant', time: 'Today 10:02' },
  { icon: Wallet, title: 'Budget captured: ₹1.2 – 1.3 Cr', meta: 'Extracted by AI from conversation', time: 'Today 10:04' },
  { icon: CalendarDays, title: 'Site visit requested for Saturday', meta: 'Waiting for availability check', time: 'Today 10:06' },
  { icon: StickyNote, title: 'Lead created from Meta Ads form', meta: 'Source: Facebook · Wakad campaign', time: 'Today 09:58' },
];
const TABS = ['Activity', 'Conversations', 'Appointments', 'Notes', 'Documents'];

export default function LeadDesign() {
  const [tab, setTab] = useState('Activity');
  return (
    <PreviewFrame active="/design/lead">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-8">
          <nav aria-label="Breadcrumb" className="text-helper mb-3">Leads / Vikram Desai</nav>
          <div className="mb-6 flex flex-wrap items-start gap-5">
            <ScoreRing size={84} score={82} factors={[{ label: 'Budget known', points: 15, max: 15, known: true }, { label: 'Location known', points: 15, max: 15, known: true }, { label: 'Buying within 30 days', points: 30, max: 30, known: true }, { label: 'Requirements clear', points: 12, max: 15, known: true }, { label: 'Site visit requested', points: 10, max: 25, known: true }]} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-title">Vikram Desai</h1><Badge tone="danger">Hot</Badge><Badge tone="primary">Qualified</Badge></div>
              <p className="text-helper mt-1 !text-[13px]">Created today · Last contacted 4 minutes ago · Next follow-up Saturday 11:00</p>
              <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-muted-foreground"><span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" aria-hidden />+91 98•••• 1204</span><span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" aria-hidden />vikram@••••.com</span><span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden />Wakad, Pune</span></div>
            </div>
            <div className="flex gap-2"><Button>Schedule visit</Button><Button variant="primary">Open conversation</Button></div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card>
              <div role="tablist" aria-label="Lead sections" className="flex gap-1 overflow-x-auto border-b border-border px-3">
                {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('relative whitespace-nowrap px-3 py-3 text-[13px] font-medium transition-colors', tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>{t}{tab === t ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}</button>)}
              </div>
              <CardBody>
                {tab === 'Activity' ? (
                  <ol className="relative space-y-6 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
                    {TIMELINE.map((e) => (
                      <li key={e.title} className="relative flex gap-4">
                        <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface"><e.icon className="h-4 w-4 text-muted-foreground" aria-hidden /></span>
                        <div className="flex-1"><p className="text-[13px] font-medium">{e.title}</p><p className="text-helper">{e.meta}</p></div>
                        <span className="text-helper num whitespace-nowrap">{e.time}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-helper py-10 text-center">{tab} appear here.</p>}
              </CardBody>
            </Card>

            <div className="space-y-4">
              <Card><CardHeader><CardTitle>Qualification</CardTitle><Badge tone="success">4 of 5 known</Badge></CardHeader><CardBody>
                <dl className="space-y-3 text-[13px]">{[['Budget', '₹1.2 – 1.3 Cr'], ['Location', 'Wakad, Pune'], ['Property type', '3 BHK apartment'], ['Buying timeline', 'Within 2 months'], ['Site visit', 'Requested · Saturday']].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>
              </CardBody></Card>
              <Card><CardHeader><CardTitle>Assigned to</CardTitle></CardHeader><CardBody className="flex items-center gap-3"><Avatar name="Sneha Kulkarni" size={32} /><div><p className="text-[13px] font-medium">Sneha Kulkarni</p><p className="text-helper">Sales Agent · 14 active leads</p></div></CardBody></Card>
              <Card><CardHeader><CardTitle>Documents</CardTitle></CardHeader><CardBody className="flex items-center gap-2 text-helper"><FileText className="h-4 w-4" aria-hidden />No documents attached</CardBody></Card>
            </div>
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}
