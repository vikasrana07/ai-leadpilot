'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { ScoreItem } from '@/lib/ai';
import { useTerms } from '@/lib/pack';

const tone = (t: string) => (t === 'HOT' ? { name: 'Hot', cls: 'text-danger', stroke: 'var(--danger)' } : t === 'WARM' ? { name: 'Warm', cls: 'text-warning', stroke: 'var(--warning)' } : t === 'COLD' ? { name: 'Cold', cls: 'text-muted-foreground', stroke: 'var(--muted-foreground)' } : { name: 'Unscored', cls: 'text-muted-foreground', stroke: 'var(--border-strong)' });

/** Animated score ring. Click or focus reveals exactly how the score was built (unknown signals are never held against a lead). */
export function ScoreRing({ score, temperature, factors, size = 72 }: { score: number | null; temperature: string; factors: ScoreItem[]; size?: number }) {
  const terms = useTerms();
  const [open, setOpen] = useState(false);
  const t = tone(temperature);
  const r = (size - 8) / 2; const c = 2 * Math.PI * r;
  const shown = score ?? 0;
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} aria-expanded={open} aria-label={`${score ?? '—'} ${t.name}. ${score === null ? 'Not scored yet.' : 'Lead score.'} Show how this score was built`} className="relative block rounded-full">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" stroke="var(--muted)" />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke={t.stroke} strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - shown / 100) }} transition={{ duration: 0.9, ease: [0.2, 0, 0, 1] }} />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center"><span className="num text-[20px] font-semibold leading-none">{score ?? '—'}</span>{' '}<span className={cn('text-[10px] font-medium uppercase tracking-wide', t.cls)}>{t.name}</span></span>
      </button>
      {open ? (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
          <p className="text-label mb-2">How this score was built</p>
          <ul className="space-y-1.5">{factors.map((f) => (
            <li key={f.key} className="flex items-start justify-between gap-3 text-[12px]">
              <span><span className={f.state === 'unknown' ? 'text-muted-foreground' : ''}>{f.label}</span><span className="text-helper block">{f.note}</span></span>
              <span className={cn('num whitespace-nowrap', f.state === 'met' ? 'font-medium text-success' : 'text-muted-foreground')}>{f.state === 'met' ? `+${f.points}` : f.state === 'not_met' ? '0' : 'unknown'}<span className="text-muted-foreground"> / {f.max}</span></span>
            </li>
          ))}</ul>
          <p className="text-helper mt-2 border-t border-border pt-2">Missing information is never counted against {terms.aLead}.</p>
        </motion.div>
      ) : null}
    </div>
  );
}
