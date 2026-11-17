'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Dropdown } from '@/components/ui/dropdown';
import { api } from '@/lib/api';
import { handleApiError } from '@/lib/forms';
import { timeAgo } from '@/lib/format';
import { notificationLabels, type Notification } from '@/lib/ops';
import { useTerms } from '@/lib/pack';

function Preferences({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const terms = useTerms();
  const labels = notificationLabels(terms);
  const prefs = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: () => api<{ preferences: { type: string; inApp: boolean }[] }>('/notifications/preferences') });
  const save = useMutation({ mutationFn: (p: { type: string; inApp: boolean }) => api('/notifications/preferences', { method: 'PUT', body: { preferences: [p] } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'prefs'] }), onError: (e) => handleApiError(e) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Notification settings" description="Choose what appears in your bell">
        <p className="text-helper mb-3">Tell me when…</p>
        <ul className="space-y-2">{(prefs.data?.preferences ?? []).map((p) => (
          <li key={p.type}><label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" checked={p.inApp} onChange={(e) => save.mutate({ type: p.type, inApp: e.target.checked })} />{labels[p.type] ?? p.type}</label></li>))}</ul>
        <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </DialogContent>
    </Dialog>
  );
}

export function NotificationBell() {
  const qc = useQueryClient(); const [prefs, setPrefs] = useState(false);
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api<{ unread: number; items: Notification[] }>('/notifications?limit=15'), refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const unread = q.data?.unread ?? 0;
  return (
    <>
      <Dropdown className="w-80 p-0" trigger={<Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}><Bell className="h-4 w-4" />{unread ? <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span> : null}</Button>}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2"><p className="text-[13px] font-semibold">Notifications</p><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!unread} onClick={() => readAll.mutate()}><CheckCheck className="h-3.5 w-3.5" aria-hidden />Mark all read</Button><Button size="icon" variant="ghost" aria-label="Notification settings" onClick={() => setPrefs(true)}><BellOff className="h-3.5 w-3.5" /></Button></div></div>
        <div className="max-h-96 overflow-y-auto">{q.data?.items.length ? q.data.items.map((n) => {
          const body = <><span className="flex items-start gap-2">{!n.read ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : <span className="w-2 shrink-0" />}<span className="min-w-0"><span className={n.read ? 'text-muted-foreground' : 'font-medium'}>{n.title}</span>{n.body ? <span className="text-helper block">{n.body}</span> : null}<span className="text-helper block">{timeAgo(n.createdAt)}</span></span></span></>;
          return n.link ? <Link key={n.id} href={n.link} onClick={() => { if (!n.read) read.mutate(n.id); }} className="block border-b border-border px-3 py-2 text-[13px] last:border-0 hover:bg-muted/50">{body}</Link> : <button key={n.id} onClick={() => { if (!n.read) read.mutate(n.id); }} className="block w-full border-b border-border px-3 py-2 text-left text-[13px] last:border-0 hover:bg-muted/50">{body}</button>;
        }) : <p className="text-helper px-3 py-8 text-center">You are all caught up.</p>}</div>
      </Dropdown>
      {prefs ? <Preferences onClose={() => setPrefs(false)} /> : null}
    </>
  );
}
