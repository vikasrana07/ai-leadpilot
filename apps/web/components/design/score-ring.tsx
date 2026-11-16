'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

export interface ScoreFactor { label: string; points: number; max: number; known: boolean }

function tone(score: number) { return score >= 70 ? { name: 'Hot', cls: 'text-danger', stroke: 'var(--danger)' } : score >= 40 ? { name: 'Warm', cls: 'text-warning', stroke: 'var(--warning)' } : { name: 'Cold', cls: 'text-muted-foreground', stroke: 'var(--muted-foreground)' }; }

/** Signature interaction: animated score ring; click or focus reveals exactly how the score was built. */
export function ScoreRing({ score, factors, size = 72 }: { score: number; factors: ScoreFactor[]; size?: number }) {
  const [open, setOpen] = useState(false);
  const t = tone(score);
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} aria-expanded={open} aria-label={`Lead score ${score}, ${t.name}. Show breakdown`} className="relative block rounded-full">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" stroke="var(--muted)" />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke={t.stroke} strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 0.9, ease: [0.2, 0, 0, 1] }} />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center"><span className="num text-[20px] font-semibold leading-none">{score}</span><span className={cn('text-[10px] font-medium uppercase tracking-wide', t.cls)}>{t.name}</span></span>
      </button>
      {open ? (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} className="absolute left-0 top-full z-20 mt-2 w-64 rounded-lg border border-border bg-card p-3 shadow-lg">
          <p className="text-label mb-2">Why {score}?</p>
          <ul className="space-y-1.5">
            {factors.map((f) => (
              <li key={f.label} className="flex items-center justify-between text-[12px]">
                <span className={f.known ? '' : 'text-muted-foreground'}>{f.label}</span>
                <span className={cn('num', f.known ? 'font-medium' : 'text-muted-foreground')}>{f.known ? `+${f.points}` : 'unknown'}<span className="text-muted-foreground"> / {f.max}</span></span>
              </li>
            ))}
          </ul>
          <p className="text-helper mt-2 border-t border-border pt-2">Missing information is never counted against a lead.</p>
        </motion.div>
      ) : null}
    </div>
  );
}
