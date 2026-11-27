'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { aiCapMessage } from '@/lib/ai-cap';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import type { UsageView } from '@/lib/ops';

const dismissKey = (level: string, resetsAt: string) => `lp:ai-cap:dismissed:${resetsAt.slice(0, 7)}:${level}`;
const readDismissed = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };

/**
 * Tells people who can see usage when the AI allowance is running out (80%, 95%) or used up, on every screen, so the AI never just
 * stops working without explanation. Warnings can be dismissed (per level, per month); the limit-reached notice cannot.
 */
export function AiCapBanner() {
  const { can } = useAuth();
  const allowed = can('usage:read');
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api<UsageView>('/usage'), staleTime: 5 * 60_000, enabled: allowed });
  const [dismissedNow, setDismissedNow] = useState<string | null>(null);
  const u = q.data?.ai;
  if (!allowed || !u) return null;
  const msg = aiCapMessage(u);
  if (!msg) return null;
  const key = dismissKey(u.level, u.resetsAt);
  const dismissible = u.level !== 'EXCEEDED';
  if (dismissible && (dismissedNow === key || readDismissed(key))) return null;
  const danger = msg.tone === 'danger';
  return (
    <div role={danger ? 'alert' : 'status'} className={cn('flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-[13px] sm:px-8', danger ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
      {danger ? <Bot className="h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="flex-1">{msg.text}</span>
      <Link href={msg.actionHref} className="font-medium underline">{msg.actionLabel}</Link>
      {dismissible ? (
        <button type="button" aria-label="Dismiss AI usage notice" className="rounded p-0.5 hover:bg-black/5" onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* storage unavailable: dismiss for this session only */ } setDismissedNow(key); }}>
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
