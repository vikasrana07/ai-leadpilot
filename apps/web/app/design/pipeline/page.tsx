'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ArrowRightLeft, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { PreviewFrame } from '@/components/design/preview-frame';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { cn } from '@/lib/cn';

const STAGES = ['New', 'Contacted', 'Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiation', 'Won', 'Lost'] as const;
type Stage = (typeof STAGES)[number];
interface Card { id: number; name: string; budget: string; score: number; agent: string; stage: Stage }

const INITIAL: Card[] = [
  { id: 1, name: 'Vikram Desai', budget: '₹1.25 Cr', score: 82, agent: 'Sneha K.', stage: 'Qualified' },
  { id: 2, name: 'Anita Kapoor', budget: '₹85 L', score: 54, agent: 'Rahul M.', stage: 'Contacted' },
  { id: 3, name: 'Rohit Sharma', budget: '₹95 L', score: 61, agent: 'Sneha K.', stage: 'Site Visit Scheduled' },
  { id: 4, name: 'Neha Joshi', budget: '₹70 L', score: 22, agent: 'Rahul M.', stage: 'New' },
  { id: 5, name: 'Karan Malhotra', budget: '₹1.6 Cr', score: 91, agent: 'Sneha K.', stage: 'Negotiation' },
  { id: 6, name: 'Pooja Singh', budget: '₹60 L', score: 38, agent: 'Rahul M.', stage: 'New' },
];

/** Example transition rule: a lead cannot jump straight from an early stage to Won. Real rules are configured per tenant. */
function canMove(from: Stage, to: Stage): string | null {
  if (to === 'Won' && STAGES.indexOf(from) < STAGES.indexOf('Negotiation') && from !== 'Lost') return 'Move the lead to Negotiation before marking it Won.';
  return null;
}

export default function PipelineDesign() {
  const [cards, setCards] = useState(INITIAL);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const move = (id: number, to: Stage) => {
    const c = cards.find((x) => x.id === id);
    if (!c || c.stage === to) return;
    const err = canMove(c.stage, to);
    if (err) { setNotice({ text: err, ok: false }); return; }
    setCards((cs) => cs.map((x) => (x.id === id ? { ...x, stage: to } : x)));
    setNotice({ text: `${c.name} moved to ${to}`, ok: true });
  };

  return (
    <PreviewFrame active="/design/pipeline">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-6 py-4">
          <div><h1 className="text-title">Sales pipeline</h1><p className="text-helper mt-0.5 !text-[13px]">Drag cards between stages, or use the menu on a card for a keyboard-friendly move.</p></div>
          <div aria-live="polite" className="h-8">
            <AnimatePresence mode="wait">{notice ? <motion.p key={notice.text} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium', notice.ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>{notice.ok ? null : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}{notice.text}</motion.p> : null}</AnimatePresence>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pb-6">
          {STAGES.map((stage) => {
            const list = cards.filter((c) => c.stage === stage);
            const blocked = drag !== null && (() => { const d = cards.find((c) => c.id === drag); return d ? canMove(d.stage, stage) !== null : false; })();
            return (
              <section key={stage} aria-label={`${stage}, ${list.length} leads`} onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver((o) => (o === stage ? null : o))} onDrop={() => { if (drag !== null) move(drag, stage); setDrag(null); setOver(null); }} className={cn('flex w-64 shrink-0 flex-col rounded-lg border bg-muted/50 transition-colors', over === stage ? (blocked ? 'border-warning bg-warning-soft/40' : 'border-primary bg-primary-soft/40') : 'border-border')}>
                <header className="flex items-center justify-between px-3 py-2.5"><h2 className="text-label">{stage}</h2><span className="num text-helper">{list.length}</span></header>
                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {list.map((c) => (
                    <motion.li layout key={c.id} transition={{ type: 'spring', stiffness: 500, damping: 40 }} draggable onDragStart={() => setDrag(c.id)} onDragEnd={() => { setDrag(null); setOver(null); }} className={cn('cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing', drag === c.id && 'opacity-50')}>
                      <div className="flex items-start justify-between gap-2"><p className="text-[13px] font-medium">{c.name}</p>
                        <Dropdown trigger={<button aria-label={`Move ${c.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted"><ArrowRightLeft className="h-3.5 w-3.5" /></button>}>
                          {STAGES.filter((s) => s !== c.stage).map((s) => <DropdownItem key={s} onSelect={() => move(c.id, s)}>Move to {s}</DropdownItem>)}
                        </Dropdown>
                      </div>
                      <p className="num text-helper mt-0.5">{c.budget}</p>
                      <div className="mt-3 flex items-center justify-between"><span className="flex items-center gap-1.5"><Avatar name={c.agent} size={20} /><span className="text-helper">{c.agent}</span></span><Badge tone={c.score >= 70 ? 'danger' : c.score >= 40 ? 'warning' : 'neutral'} className="num">{c.score}</Badge></div>
                    </motion.li>
                  ))}
                  {list.length === 0 ? <li className="rounded-lg border border-dashed border-border-strong py-6 text-center text-helper">Drop a lead here</li> : null}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </PreviewFrame>
  );
}
