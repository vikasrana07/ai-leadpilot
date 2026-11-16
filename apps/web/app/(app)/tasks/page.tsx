'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, ListChecks, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs } from '@/lib/crm';
import { handleApiError } from '@/lib/forms';
import { timeAgo } from '@/lib/format';
import type { TaskItem } from '@/lib/ops';

export default function TasksPage() {
  const { can } = useAuth(); const qc = useQueryClient();
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN'); const [mine, setMine] = useState(true); const [title, setTitle] = useState(''); const [due, setDue] = useState('');
  const list = useQuery({ queryKey: ['tasks', status, mine], queryFn: () => api<{ items: TaskItem[] }>(`/tasks${qs({ status, mine: mine ? 'true' : 'false', limit: 100 })}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const add = useMutation({ mutationFn: () => api('/tasks', { method: 'POST', body: { title, ...(due ? { dueAt: new Date(due).toISOString() } : {}) } }), onSuccess: async () => { setTitle(''); setDue(''); await refresh(); }, onError: (e) => handleApiError(e) });
  const toggle = useMutation({ mutationFn: (t: TaskItem) => api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'OPEN' ? 'DONE' : 'OPEN' } }), onSuccess: refresh, onError: (e) => handleApiError(e) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/tasks/${id}`, { method: 'DELETE' }), onSuccess: async () => { toast.success('Task deleted'); await refresh(); }, onError: (e) => handleApiError(e) });
  return (
    <>
      <PageHeader title="Tasks" description="Follow-ups from you, your team and your automations." />
      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-border p-3" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
          <Input aria-label="New task" placeholder="Add a task, e.g. Send brochure to Priya" className="min-w-56 flex-1" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input aria-label="Due" type="datetime-local" className="w-52" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button type="submit" variant="primary" loading={add.isPending} disabled={!title.trim()}><Plus className="h-4 w-4" aria-hidden />Add</Button>
          <Select aria-label="Show" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as 'OPEN' | 'DONE')}><option value="OPEN">Open</option><option value="DONE">Done</option></Select>
          {can('lead:read:all') ? <Select aria-label="Whose" className="w-auto" value={mine ? 'mine' : 'all'} onChange={(e) => setMine(e.target.value === 'mine')}><option value="mine">Mine</option><option value="all">Everyone’s</option></Select> : null}
        </form>
        {list.isPending ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div> : list.data?.items.length === 0 ? <EmptyState icon={ListChecks} title={status === 'OPEN' ? 'Nothing to do' : 'No completed tasks'} description={status === 'OPEN' ? 'Tasks you add, and ones created by automations, show up here.' : 'Completed tasks appear here.'} /> : (
          <ul className="divide-y divide-border">{list.data?.items.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <button aria-label={t.status === 'OPEN' ? `Mark ${t.title} done` : `Reopen ${t.title}`} onClick={() => toggle.mutate(t)} className="text-muted-foreground hover:text-primary">{t.status === 'DONE' ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5" />}</button>
              <div className="min-w-0 flex-1"><p className={t.status === 'DONE' ? 'text-muted-foreground line-through' : 'font-medium'}>{t.title}</p><p className="text-helper">{t.leadId ? <Link href={`/leads/${t.leadId}`} className="hover:text-foreground">{t.leadName}</Link> : 'No lead'}{!mine && t.assigneeName ? ` · ${t.assigneeName}` : ''}{t.source === 'automation' ? ' · from an automation' : ''}</p></div>
              {t.dueAt ? <Badge tone={t.overdue ? 'danger' : 'neutral'}>{t.overdue ? 'Overdue ' : 'Due '}{timeAgo(t.dueAt)}</Badge> : null}
              <Button size="icon" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => remove.mutate(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>))}</ul>)}
      </Card>
    </>
  );
}
