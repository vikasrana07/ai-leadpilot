'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, Globe, MessageCircle, Paperclip, RotateCcw, Send, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL, api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import type { ChatMessage, ConversationDetail, WaTemplate } from '@/lib/inbox';

interface MessagePage { items: ChatMessage[]; hasMore: boolean }

function StatusIcon({ m }: { m: ChatMessage }) {
  if (m.direction !== 'OUTBOUND' || m.senderType === 'SYSTEM') return null;
  if (m.status === 'FAILED') return <AlertCircle className="h-3 w-3" aria-label="Failed to send" />;
  if (m.status === 'QUEUED') return <Clock className="h-3 w-3" aria-label="Sending" />;
  if (m.status === 'SENT') return <Check className="h-3 w-3" aria-label="Sent" />;
  if (m.status === 'DELIVERED') return <CheckCheck className="h-3 w-3" aria-label="Delivered" />;
  return <CheckCheck className="h-3 w-3 text-sky-300" aria-label="Read" />;
}

function Bubble({ m, convoId, onRetry }: { m: ChatMessage; convoId: string; onRetry: (id: string) => void }) {
  if (m.senderType === 'SYSTEM') return <div className="text-helper text-center">{m.body}</div>;
  const out = m.direction === 'OUTBOUND';
  const mediaUrl = `${API_URL}/conversations/${convoId}/messages/${m.id}/media`;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[78%] rounded-xl px-3.5 py-2 text-[13px] shadow-sm', out ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-card', m.status === 'FAILED' && 'ring-2 ring-danger')}>
        {m.type === 'IMAGE' && m.media ? <a href={mediaUrl} target="_blank" rel="noreferrer"><img src={mediaUrl} alt={m.media.caption ?? 'Image from customer'} className="mb-1.5 max-h-60 rounded-md" loading="lazy" /></a> : null}
        {(m.type === 'DOCUMENT' || m.type === 'AUDIO' || m.type === 'VIDEO') && m.media ? <a href={mediaUrl} download className="mb-1.5 flex items-center gap-2 rounded-md bg-black/10 px-2.5 py-2 underline-offset-2 hover:underline"><FileText className="h-4 w-4" aria-hidden />{m.media.filename ?? `${m.type.toLowerCase()} file`}</a> : null}
        {m.type === 'TEMPLATE' ? <p className="mb-0.5 flex items-center gap-1 text-[11px] opacity-80"><Paperclip className="h-3 w-3" aria-hidden />Template message</p> : null}
        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
        <p className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', out ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {m.senderType === 'AI' ? <Bot className="h-3 w-3" aria-label="Sent by the AI assistant" /> : null}
          {out && m.sender ? `${m.sender.split(' ')[0]} · ` : ''}{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<StatusIcon m={m} />
        </p>
        {m.status === 'FAILED' ? (
          <p className="mt-1.5 flex items-center gap-2 border-t border-white/20 pt-1.5 text-[11px]">{m.error?.message ?? 'Could not send'}<button className="inline-flex items-center gap-1 underline" onClick={() => onRetry(m.id)}><RotateCcw className="h-3 w-3" aria-hidden />Retry</button></p>
        ) : null}
      </div>
    </motion.div>
  );
}

export function Thread({ convo }: { convo: ConversationDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const bottom = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [tpl, setTpl] = useState({ id: '', params: [] as string[] });
  const messages = useInfiniteQuery({
    queryKey: ['conversations', 'messages', convo.id], initialPageParam: '' as string,
    queryFn: ({ pageParam }) => api<MessagePage>(`/conversations/${convo.id}/messages${pageParam ? `?before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
  });
  const items = useMemo(() => (messages.data ? [...messages.data.pages].reverse().flatMap((p) => p.items) : []), [messages.data]);
  const lastId = items.at(-1)?.id;
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [lastId, convo.id]);

  const isWa = convo.channel.type === 'WHATSAPP';
  const needsTemplate = isWa && !convo.windowOpen;
  const templates = useQuery({ queryKey: ['whatsapp', 'templates'], enabled: needsTemplate && can('conversation:reply'), queryFn: () => api<WaTemplate[]>('/whatsapp/templates') });
  const chosen = templates.data?.find((t) => t.id === tpl.id);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['conversations'] })]);
  const send = useMutation({
    mutationFn: (body: object) => api<ChatMessage>(`/conversations/${convo.id}/messages`, { method: 'POST', body: { ...body, idempotencyKey: crypto.randomUUID() } }),
    onSuccess: async (m) => { setText(''); setTpl({ id: '', params: [] }); if (m.status === 'FAILED') toast.error(m.error?.message ?? 'Message could not be sent'); await refresh(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not send'),
  });
  const retry = useMutation({ mutationFn: (id: string) => api(`/conversations/${convo.id}/messages/${id}/retry`, { method: 'POST' }), onSuccess: refresh, onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Retry failed') });
  const act = useMutation({ mutationFn: (a: string) => api(`/conversations/${convo.id}/${a}`, { method: 'POST' }), onSuccess: refresh, onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Action failed') });

  const canReply = can('conversation:reply');
  const optedOut = convo.whatsappConsent === 'OPTED_OUT';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background p-4" role="log" aria-live="polite" aria-label="Messages">
        {messages.hasNextPage ? <div className="text-center"><Button size="sm" variant="ghost" loading={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>Load earlier messages</Button></div> : null}
        {messages.isPending ? <><Skeleton className="h-12 w-2/3" /><Skeleton className="ml-auto h-12 w-1/2" /></> : items.length === 0 ? <p className="text-helper py-10 text-center">No messages yet.</p> : items.map((m) => <Bubble key={m.id} m={m} convoId={convo.id} onRetry={(id) => retry.mutate(id)} />)}
        <div ref={bottom} />
      </div>

      <div className="border-t border-border bg-surface p-3">
        {!canReply ? <p className="text-helper text-center">You can read this conversation but not reply.</p>
          : convo.status === 'CLOSED' ? <div className="flex items-center justify-between gap-3 text-[13px]"><span className="text-muted-foreground">This conversation is closed. Replying reopens it.</span><Button size="sm" onClick={() => act.mutate('reopen')}>Reopen</Button></div>
          : convo.mode === 'AI' ? <div className="flex flex-col items-center gap-2 py-1"><Button variant="primary" size="lg" loading={act.isPending} onClick={() => act.mutate('takeover')}><UserRound className="h-4 w-4" aria-hidden />Join conversation</Button><p className="text-helper">The AI assistant keeps replying until you join.</p></div>
          : optedOut ? <p className="rounded-md bg-warning-soft p-3 text-[13px] text-warning">This customer opted out of WhatsApp messages. You cannot message them here unless they write to you again.</p>
          : needsTemplate ? (
            <div className="space-y-2">
              <p className="rounded-md bg-warning-soft p-2.5 text-[12px] text-warning">The customer last wrote more than 24 hours ago, so WhatsApp only allows an approved template message now.</p>
              {templates.data?.length === 0 ? <p className="text-helper">No templates registered yet. An owner can add approved templates in Integrations.</p> : (
                <div className="space-y-2">
                  <Select aria-label="Template" value={tpl.id} onChange={(e) => { const t = templates.data?.find((x) => x.id === e.target.value); setTpl({ id: e.target.value, params: Array.from({ length: t?.variableCount ?? 0 }, () => '') }); }}><option value="">Choose a template…</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}</Select>
                  {chosen ? <><p className="rounded-md bg-muted p-2 text-[12px]">{chosen.bodyPreview}</p>{tpl.params.map((v, i) => <input key={i} aria-label={`Value for {{${i + 1}}}`} placeholder={`Value for {{${i + 1}}}`} value={v} onChange={(e) => setTpl((s) => ({ ...s, params: s.params.map((p, j) => (j === i ? e.target.value : p)) }))} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px]" />)}</> : null}
                  <div className="flex justify-end"><Button variant="primary" size="sm" disabled={!chosen || tpl.params.some((p) => !p.trim())} loading={send.isPending} onClick={() => chosen && send.mutate({ template: { name: chosen.name, language: chosen.language, params: tpl.params } })}><Send className="h-3.5 w-3.5" aria-hidden />Send template</Button></div>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate({ text: text.trim() }); }} className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
              <textarea aria-label="Write a reply" rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim() && !send.isPending) send.mutate({ text: text.trim() }); } }} placeholder="Write a reply…  (Enter to send, Shift+Enter for a new line)" className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[13px] outline-none placeholder:text-muted-foreground" />
              <Button type="submit" variant="primary" size="icon" aria-label="Send" loading={send.isPending} disabled={!text.trim()}><Send className="h-4 w-4" /></Button>
            </form>
          )}
        {canReply && convo.status === 'OPEN' && convo.mode === 'HUMAN' ? <div className="mt-2 flex items-center justify-between text-[12px] text-muted-foreground"><span>{isWa ? (convo.windowOpen ? `Reply window open${convo.windowExpiresAt ? ` · closes ${timeAgo(convo.windowExpiresAt)}` : ''}` : 'Reply window closed') : 'Website chat'}</span><button className="hover:text-foreground hover:underline" onClick={() => act.mutate('handback')}>Hand back to AI</button></div> : null}
      </div>
    </div>
  );
}

export function ChannelIcon({ type, className }: { type: 'WHATSAPP' | 'WEB_WIDGET'; className?: string }) {
  return type === 'WHATSAPP' ? <MessageCircle className={className} aria-label="WhatsApp" /> : <Globe className={className} aria-label="Website chat" />;
}
