'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, StickyNote } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TemperatureBadge } from '@/components/crm/lead-badges';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMembers } from '@/lib/crm';
import { formatBudget, TIMELINE_LABELS, timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';
import type { ConversationDetail } from '@/lib/inbox';

interface Note { id: string; body: string; author: string; createdAt: string }

/** Right-hand context: who this is, qualification, ownership, internal notes (never sent to the customer). */
export function DetailsPanel({ convo }: { convo: ConversationDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const members = useMembers();
  const [note, setNote] = useState('');
  const notes = useQuery({ queryKey: ['conversations', 'notes', convo.id], queryFn: () => api<Note[]>(`/conversations/${convo.id}/notes`) });
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['conversations'] })]);
  const assign = useMutation({ mutationFn: (m: string) => api(`/conversations/${convo.id}/assign`, { method: 'POST', body: { assignedMembershipId: m || null } }), onSuccess: invalidate, onError: (e) => handleApiError(e) });
  const addNote = useMutation({ mutationFn: (b: string) => api(`/conversations/${convo.id}/notes`, { method: 'POST', body: { body: b } }), onSuccess: async () => { setNote(''); await invalidate(); }, onError: (e) => handleApiError(e) });
  const l = convo.lead;

  return (
    <div className="space-y-5 p-4">
      {l ? (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={l.name} size={40} />
            <div className="min-w-0 flex-1"><p className="truncate text-heading">{l.name}</p><div className="mt-0.5 flex flex-wrap gap-1.5"><TemperatureBadge value={l.temperature as 'HOT'} />{l.score !== null ? <Badge tone="primary" className="num">Score {l.score}</Badge> : null}</div></div>
          </div>
          <dl className="space-y-2.5 text-[13px]">
            {[['Phone', l.phone ?? '—'], ['Email', l.email ?? '—'], ['Stage', l.stage.name], ['Source', l.source ?? '—'], ['Budget', formatBudget(l.budgetMin, l.budgetMax)], ['Location', l.location ?? '—'], ['Property', l.propertyType ?? '—'], ['Timeline', TIMELINE_LABELS[l.buyingTimeline] ?? '—']].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="num truncate text-right font-medium">{v}</dd></div>)}
          </dl>
          <Button asChild variant="secondary" size="sm" className="w-full"><Link href={`/leads/${l.id}`}><ExternalLink className="h-3.5 w-3.5" aria-hidden />Open lead</Link></Button>
        </>
      ) : null}

      <div>
        <label htmlFor="convo-assignee" className="text-label mb-1.5 block">Conversation owner</label>
        {can('conversation:assign') ? <Select id="convo-assignee" value={convo.assignee?.id ?? ''} onChange={(e) => assign.mutate(e.target.value)}><option value="">Unassigned</option>{members.data?.filter((m) => m.status === 'ACTIVE').map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</Select> : <p className="text-[13px]">{convo.assignee?.name ?? 'Unassigned'}</p>}
      </div>

      {convo.channel.type === 'WHATSAPP' ? <p className="text-helper">WhatsApp consent: {convo.whatsappConsent === 'OPTED_IN' ? 'opted in' : convo.whatsappConsent === 'OPTED_OUT' ? 'opted out' : 'not recorded'}</p> : null}

      <div className="rounded-lg border border-border p-3">
        <p className="text-label mb-2 flex items-center gap-1.5"><StickyNote className="h-3.5 w-3.5" aria-hidden />Internal notes</p>
        {can('conversation:reply') ? (
          <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(note.trim()); }} className="space-y-2">
            <Textarea aria-label="Add an internal note" className="min-h-16" placeholder="Only your team sees this" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex justify-end"><Button type="submit" size="sm" loading={addNote.isPending} disabled={!note.trim()}>Add note</Button></div>
          </form>
        ) : null}
        <ul className="mt-3 space-y-2">{notes.data?.map((n) => <li key={n.id} className="rounded-md bg-muted p-2 text-[13px]"><p className="whitespace-pre-wrap">{n.body}</p><p className="text-helper mt-1">{n.author} · {timeAgo(n.createdAt)}</p></li>)}</ul>
        {notes.data?.length === 0 ? <p className="text-helper mt-2">No notes yet.</p> : null}
      </div>
    </div>
  );
}
