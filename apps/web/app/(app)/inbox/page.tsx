'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Info, Inbox as InboxIcon, Search, UserRound, XCircle } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DetailsPanel } from '@/components/inbox/details-panel';
import { ChannelIcon, Thread } from '@/components/inbox/thread';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { qs } from '@/lib/crm';
import { timeAgo } from '@/lib/format';
import type { ConversationDetail, ConversationList } from '@/lib/inbox';
import { useSearchParams, useRouter } from 'next/navigation';

type Queue = 'open' | 'mine' | 'unassigned' | 'unread' | 'ai' | 'closed';
const QUEUES: { key: Queue; label: string; params: Record<string, string> }[] = [
  { key: 'open', label: 'All open', params: { status: 'OPEN' } },
  { key: 'mine', label: 'Mine', params: { status: 'OPEN', assigned: 'me' } },
  { key: 'unassigned', label: 'Unassigned', params: { status: 'OPEN', assigned: 'unassigned' } },
  { key: 'unread', label: 'Unread', params: { status: 'OPEN', unread: 'true' } },
  { key: 'ai', label: 'AI handling', params: { status: 'OPEN', mode: 'AI' } },
  { key: 'closed', label: 'Closed', params: { status: 'CLOSED' } },
];

function InboxView() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get('c');
  const [queue, setQueue] = useState<Queue>('open');
  const [channel, setChannel] = useState<'' | 'WHATSAPP' | 'WEB_WIDGET'>('');
  const [search, setSearch] = useState(''); const q = useDebounce(search, 300);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canAll = can('conversation:read:all');

  const queryParams = { ...(QUEUES.find((x) => x.key === queue)?.params ?? {}), channelType: channel, q, pageSize: 50 };
  const list = useQuery({ queryKey: ['conversations', 'list', queryParams], queryFn: () => api<ConversationList>(`/conversations${qs(queryParams)}`), placeholderData: (p) => p });
  const detail = useQuery({ queryKey: ['conversations', 'detail', selectedId], enabled: !!selectedId, queryFn: () => api<ConversationDetail>(`/conversations/${selectedId}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const select = (id: string | null) => router.replace(id ? `/inbox?c=${id}` : '/inbox', { scroll: false });

  // Opening a conversation marks it read.
  const { mutate: markReadMutate, isPending: markingRead } = useMutation({ mutationFn: (id: string) => api(`/conversations/${id}/read`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }) });
  const unread = detail.data?.unreadCount ?? 0;
  useEffect(() => { if (selectedId && unread > 0 && !markingRead) markReadMutate(selectedId); }, [selectedId, unread, markingRead, markReadMutate]);

  const close = useMutation({ mutationFn: (a: { id: string; action: 'close' | 'reopen' }) => api(`/conversations/${a.id}/${a.action}`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }), onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed') });
  const items = list.data?.items ?? [];

  return (
    <div className="-mx-4 -my-5 flex h-[calc(100dvh-3.5rem)] sm:-mx-6 sm:-my-6">
      {/* queues (wide screens) */}
      <nav aria-label="Queues" className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border bg-header p-3 xl:flex">
        <h1 className="text-title px-2 pb-2 pt-1">Inbox</h1>
        {QUEUES.filter((x) => canAll || x.key !== 'unassigned').map((x) => (
          <button key={x.key} onClick={() => { setQueue(x.key); select(null); }} aria-current={queue === x.key} className={cn('flex items-center justify-between rounded-md px-2.5 py-2 text-[13px]', queue === x.key ? 'bg-surface font-medium shadow-sm' : 'text-muted-foreground hover:bg-muted')}>
            {x.label}{x.key === 'unread' && list.data && list.data.unreadTotal > 0 ? <span className="num rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{list.data.unreadTotal}</span> : null}
          </button>
        ))}
        <p className="text-label mt-4 px-2 text-muted-foreground">Channel</p>
        {([['', 'All channels'], ['WHATSAPP', 'WhatsApp'], ['WEB_WIDGET', 'Website chat']] as const).map(([v, label]) => <button key={v} onClick={() => setChannel(v)} aria-pressed={channel === v} className={cn('rounded-md px-2.5 py-1.5 text-left text-[13px]', channel === v ? 'bg-surface font-medium shadow-sm' : 'text-muted-foreground hover:bg-muted')}>{label}</button>)}
      </nav>

      {/* list */}
      <section aria-label="Conversations" className={cn('flex w-full shrink-0 flex-col border-r border-border bg-surface md:w-80', selectedId ? 'hidden md:flex' : 'flex')}>
        <div className="space-y-2 border-b border-border p-3">
          <h1 className="text-title xl:hidden">Inbox</h1>
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /><input aria-label="Search conversations" placeholder="Search by name, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/25" /></div>
          <div className="flex gap-1.5 overflow-x-auto xl:hidden">{QUEUES.filter((x) => canAll || x.key !== 'unassigned').map((x) => <button key={x.key} aria-pressed={queue === x.key} onClick={() => setQueue(x.key)} className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px]', queue === x.key ? 'bg-primary-soft font-medium text-accent-foreground' : 'text-muted-foreground')}>{x.label}</button>)}</div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.isPending ? [0, 1, 2, 3].map((i) => <li key={i} className="p-3"><Skeleton className="h-12" /></li>) : items.length === 0 ? (
            <li><EmptyState icon={InboxIcon} title={q || channel || queue !== 'open' ? 'Nothing here' : 'No conversations yet'} description={q || channel || queue !== 'open' ? 'Try another queue or clear the search.' : 'Messages from WhatsApp and your website chat appear here the moment they arrive. Connect a channel in Integrations.'} action={can('integration:manage') && queue === 'open' && !q ? <Button asChild variant="primary" size="sm"><Link href="/integrations">Connect a channel</Link></Button> : undefined} /></li>
          ) : items.map((c) => (
            <li key={c.id}>
              <button onClick={() => select(c.id)} aria-current={c.id === selectedId} className={cn('flex w-full gap-3 border-b border-border px-3 py-3 text-left transition-colors', c.id === selectedId ? 'bg-primary-soft/60' : 'hover:bg-muted/60')}>
                <Avatar name={c.lead?.name ?? '?'} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><span className={cn('truncate text-[13px]', c.unreadCount ? 'font-semibold' : 'font-medium')}>{c.lead?.name ?? 'Unknown'}</span><span className="text-helper num shrink-0">{timeAgo(c.lastMessageAt).replace(' ago', '')}</span></span>
                  <span className="flex items-center gap-1.5"><ChannelIcon type={c.channel.type} className="h-3 w-3 shrink-0 text-muted-foreground" /><span className={cn('truncate text-[12px]', c.unreadCount ? 'text-foreground' : 'text-muted-foreground')}>{c.preview ?? '—'}</span></span>
                  <span className="mt-1 flex items-center gap-1.5">{c.mode === 'AI' ? <Badge tone="primary"><Bot className="h-3 w-3" aria-hidden />AI</Badge> : null}{c.assignee ? <span className="text-helper">{c.assignee.name.split(' ')[0]}</span> : <span className="text-helper">Unassigned</span>}{c.tags.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}</span>
                </span>
                {c.unreadCount ? <span aria-label={`${c.unreadCount} unread`} className="num mt-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{c.unreadCount}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* conversation */}
      <section aria-label="Conversation" className={cn('min-w-0 flex-1 flex-col bg-background', selectedId ? 'flex' : 'hidden md:flex')}>
        {!selectedId ? <div className="m-auto"><EmptyState icon={InboxIcon} title="Select a conversation" description="Pick one from the list to read and reply." /></div>
          : detail.isPending ? <div className="space-y-3 p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>
          : detail.isError ? <div className="m-auto"><EmptyState icon={XCircle} title="Conversation not found" description="It may belong to someone else, or it was removed." action={<Button onClick={() => select(null)}>Back to inbox</Button>} /></div>
          : (
            <>
              <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Back to conversations" onClick={() => select(null)}><ArrowLeft className="h-4 w-4" /></Button>
                <Avatar name={detail.data.lead?.name ?? '?'} size={32} />
                <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{detail.data.lead?.name}</p><p className="text-helper flex items-center gap-1"><ChannelIcon type={detail.data.channel.type} className="h-3 w-3" />{detail.data.channel.type === 'WHATSAPP' ? detail.data.lead?.phone : detail.data.lead?.phone ?? detail.data.lead?.email}</p></div>
                <Badge tone={detail.data.mode === 'AI' ? 'primary' : 'success'}>{detail.data.mode === 'AI' ? <><Bot className="h-3 w-3" aria-hidden />AI handling</> : <><UserRound className="h-3 w-3" aria-hidden />Team</>}</Badge>
                {can('conversation:reply') ? <Button size="sm" variant="secondary" onClick={() => close.mutate({ id: detail.data.id, action: detail.data.status === 'OPEN' ? 'close' : 'reopen' })}>{detail.data.status === 'OPEN' ? 'Close' : 'Reopen'}</Button> : null}
                <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Customer details" onClick={() => setDetailsOpen(true)}><Info className="h-4 w-4" /></Button>
              </header>
              <Thread key={detail.data.id} convo={detail.data} />
            </>
          )}
      </section>

      {/* details (wide screens) */}
      {detail.data ? <aside aria-label="Customer details" className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-surface xl:block"><DetailsPanel convo={detail.data} /></aside> : null}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent title="Customer details" className="max-h-[85vh] max-w-md overflow-y-auto">{detail.data ? <DetailsPanel convo={detail.data} /> : null}</DialogContent></Dialog>
    </div>
  );
}

export default function InboxPage() {
  return <Suspense><InboxView /></Suspense>;
}
