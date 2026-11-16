'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Bot, CalendarClock, Check, CheckCheck, Globe, MessageCircle, Paperclip, Search, Send, UserRound } from 'lucide-react';
import { useState } from 'react';
import { PreviewFrame } from '@/components/design/preview-frame';
import { ScoreRing } from '@/components/design/score-ring';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const CONVOS = [
  { id: 1, name: 'Vikram Desai', channel: 'whatsapp', preview: 'Can we see the 3BHK on Saturday?', time: '2m', unread: 2, mode: 'ai', score: 82 },
  { id: 2, name: 'Anita Kapoor', channel: 'web', preview: 'Budget is around 85 lakhs in Baner', time: '14m', unread: 0, mode: 'ai', score: 54 },
  { id: 3, name: 'Rohit Sharma', channel: 'whatsapp', preview: 'Please call me, I have questions about the loan', time: '1h', unread: 1, mode: 'human', score: 61 },
  { id: 4, name: 'Neha Joshi', channel: 'web', preview: 'Thanks, will think about it', time: '3h', unread: 0, mode: 'ai', score: 22 },
];
const MESSAGES = [
  { from: 'customer', text: 'Hi, I saw the Greenfield Heights ad. Is a 3BHK available?', time: '10:02' },
  { from: 'ai', text: 'Hello Vikram! Yes, we have 3BHK units available at Greenfield Heights, Wakad. Prices start at ₹1.12 Cr. What budget range are you considering?', time: '10:02', status: 'read' },
  { from: 'customer', text: 'Around 1.2 to 1.3 crore. Looking to move in the next two months.', time: '10:04' },
  { from: 'ai', text: 'That fits well. Would you like to visit the site? I can check availability this Saturday.', time: '10:04', status: 'read' },
  { from: 'customer', text: 'Can we see the 3BHK on Saturday?', time: '10:06' },
];

export default function InboxDesign() {
  const [active, setActive] = useState(1);
  const [mode, setMode] = useState<'ai' | 'human'>('ai');
  const convo = CONVOS.find((c) => c.id === active) ?? CONVOS[0]!;
  return (
    <PreviewFrame active="/design/inbox">
      <div className="grid h-full grid-cols-1 md:grid-cols-[320px_1fr] xl:grid-cols-[208px_320px_1fr_300px]">
        {/* Queues */}
        <nav aria-label="Queues" className="hidden min-h-0 flex-col gap-5 overflow-y-auto border-r border-border bg-header p-4 xl:flex">
          <h1 className="text-title">Inbox</h1>
          <div>
            <p className="text-label mb-2 text-muted-foreground">Live conversations</p>
            <ul className="space-y-0.5">
              {[['Unassigned', 5, true], ['Mine', 3, false], ['AI handling', 12, false], ['Needs a human', 2, false]].map(([l, n, a]) => (
                <li key={String(l)}><span className={cn('flex items-center justify-between rounded-md px-2.5 py-2 text-[13px]', a ? 'bg-surface font-medium shadow-sm' : 'text-muted-foreground')}>{l}<span className={cn('num rounded-full px-1.5 text-[11px] font-semibold', l === 'Needs a human' ? 'bg-danger text-white' : a ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{n}</span></span></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-label mb-2 text-muted-foreground">Channels</p>
            <ul className="space-y-0.5 text-[13px] text-muted-foreground">{[['WhatsApp', MessageCircle], ['Website chat', Globe]].map(([l, Icon]) => { const I = Icon as typeof Globe; return <li key={String(l)} className="flex items-center gap-2 px-2.5 py-2"><I className="h-4 w-4" aria-hidden />{String(l)}</li>; })}</ul>
          </div>
          <div>
            <p className="text-label mb-2 text-muted-foreground">Closed</p>
            <p className="px-2.5 text-[13px] text-muted-foreground">Resolved · Archived</p>
          </div>
        </nav>
        {/* Conversation list */}
        <aside className="flex min-h-0 flex-col border-r border-border bg-surface">
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] text-muted-foreground"><Search className="h-4 w-4" aria-hidden />Search conversations</div>
            <div className="flex gap-1.5 text-[12px]">{['All', 'Unassigned', 'Mine', 'Unread'].map((f, i) => <span key={f} className={cn('rounded-full px-2.5 py-1', i === 0 ? 'bg-primary-soft font-medium text-accent-foreground' : 'text-muted-foreground')}>{f}</span>)}</div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {CONVOS.map((c) => (
              <li key={c.id}>
                <button onClick={() => { setActive(c.id); setMode(c.mode as 'ai' | 'human'); }} aria-current={c.id === active} className={cn('flex w-full gap-3 border-b border-border px-3 py-3 text-left transition-colors', c.id === active ? 'bg-primary-soft/60' : 'hover:bg-muted/60')}>
                  <Avatar name={c.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between"><span className="truncate text-[13px] font-medium">{c.name}</span><span className="text-helper">{c.time}</span></span>
                    <span className="flex items-center gap-1.5"><span className="text-muted-foreground">{c.channel === 'whatsapp' ? <MessageCircle className="h-3 w-3" aria-label="WhatsApp" /> : <Globe className="h-3 w-3" aria-label="Website chat" />}</span><span className="truncate text-[12px] text-muted-foreground">{c.preview}</span></span>
                  </span>
                  {c.unread ? <span className="num mt-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{c.unread}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Timeline + composer */}
        <section className="flex min-h-0 flex-col bg-background">
          <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
            <Avatar name={convo.name} size={32} />
            <div className="flex-1"><p className="text-[13px] font-medium">{convo.name}</p><p className="text-helper">{convo.channel === 'whatsapp' ? 'WhatsApp · +91 98•••• 1204' : 'Website chat'} · session window open</p></div>
            <Badge tone={mode === 'ai' ? 'primary' : 'success'}>{mode === 'ai' ? <><Bot className="h-3 w-3" aria-hidden />AI handling</> : <><UserRound className="h-3 w-3" aria-hidden />You are handling</>}</Badge>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {MESSAGES.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.18 }} className={cn('flex', m.from === 'customer' ? 'justify-start' : 'justify-end')}>
                <div className={cn('max-w-[78%] rounded-xl px-3.5 py-2 text-[13px] shadow-sm', m.from === 'customer' ? 'rounded-bl-sm bg-card' : 'rounded-br-sm bg-primary text-primary-foreground')}>
                  <p>{m.text}</p>
                  <p className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', m.from === 'customer' ? 'text-muted-foreground' : 'text-primary-foreground/70')}>{m.from === 'ai' ? <Bot className="h-3 w-3" aria-label="Sent by AI" /> : null}{m.time}{m.status === 'read' ? <CheckCheck className="h-3 w-3" aria-label="Read" /> : m.from === 'ai' ? <Check className="h-3 w-3" aria-label="Sent" /> : null}</p>
                </div>
              </motion.div>
            ))}
            <AnimatePresence>{mode === 'ai' ? <motion.div key="typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-end"><div className="flex items-center gap-1 rounded-xl rounded-br-sm bg-primary-soft px-3.5 py-3" aria-label="Assistant is typing">{[0, 1, 2].map((d) => <motion.span key={d} className="h-1.5 w-1.5 rounded-full bg-primary" animate={{ y: [0, -3, 0] }} transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }} />)}</div></motion.div> : null}</AnimatePresence>
          </div>
          <div className="border-t border-border bg-surface p-4">
            {mode === 'ai' ? (
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <Button variant="primary" size="lg" onClick={() => setMode('human')}><UserRound className="h-4 w-4" aria-hidden />Join conversation</Button>
                <p className="text-helper">The assistant keeps replying until you join. You can hand the chat back at any time.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
                  <Button variant="ghost" size="icon" aria-label="Attach file"><Paperclip className="h-4 w-4" /></Button>
                  <div className="min-h-9 flex-1 px-1 py-2 text-[13px] text-muted-foreground">Write a reply…</div>
                  <Button variant="primary" size="icon" aria-label="Send"><Send className="h-4 w-4" /></Button>
                </div>
                <button onClick={() => setMode('ai')} className="mt-2 flex items-center gap-1.5 text-[12px] text-primary hover:underline"><Bot className="h-3.5 w-3.5" aria-hidden />Hand back to AI assistant</button>
              </div>
            )}
          </div>
        </section>

        {/* Lead context */}
        <aside className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface p-4 xl:block">
          <div className="flex items-center gap-4"><ScoreRing score={convo.score} factors={[{ label: 'Budget known', points: 15, max: 15, known: true }, { label: 'Location known', points: 15, max: 15, known: true }, { label: 'Buying within 30 days', points: 30, max: 30, known: true }, { label: 'Requirements clear', points: 12, max: 15, known: true }, { label: 'Site visit requested', points: 10, max: 25, known: convo.score > 60 }]} /><div><p className="text-heading">{convo.name}</p><Badge tone={convo.score >= 70 ? 'danger' : 'warning'}>{convo.score >= 70 ? 'Hot lead' : 'Warm lead'}</Badge></div></div>
          <dl className="mt-5 space-y-3 text-[13px]">
            {[['Budget', '₹1.2 – 1.3 Cr'], ['Location', 'Wakad, Pune'], ['Property', '3 BHK apartment'], ['Timeline', 'Within 2 months'], ['Assigned to', 'Sneha Kulkarni']].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
          </dl>
          <div className="mt-5 rounded-lg border border-border p-3"><p className="text-label mb-1 flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" aria-hidden />Appointments</p><p className="text-helper">No site visit booked yet. The assistant is checking Saturday slots.</p></div>
          <div className="mt-3 rounded-lg border border-dashed border-border-strong p-3"><p className="text-label mb-1">Internal notes</p><p className="text-helper">Only your team sees these.</p></div>
        </aside>
      </div>
    </PreviewFrame>
  );
}
