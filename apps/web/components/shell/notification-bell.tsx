'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Dropdown } from '@/components/ui/dropdown';
import { api } from '@/lib/api';
import { audioReady, desktopState, enableDesktop, playBeep, unlockAudio, withUnreadTitle, type DesktopState } from '@/lib/alerts';
import { useAlertSettings } from '@/hooks/use-alert-settings';
import { handleApiError } from '@/lib/forms';
import { timeAgo } from '@/lib/format';
import { notificationLabels, type Notification } from '@/lib/ops';
import { useTerms } from '@/lib/pack';

/** Sound and desktop alerts. The choices are saved on the account; the browser permission is per browser and can only be asked from a click. */
function SoundAndAlerts() {
  const { settings, loaded, update } = useAlertSettings();
  // Rendered only inside the settings dialog, which opens on a click (never during server rendering), so the browser state can be read directly.
  const [state, setState] = useState<DesktopState>(() => desktopState());
  const [ready, setReady] = useState(() => audioReady());
  const test = () => { unlockAudio(); setReady(audioReady()); playBeep(settings.soundVolume); };
  return (
    <fieldset className="mb-3 space-y-3 rounded-md border border-border p-3 text-[13px]" disabled={!loaded}>
      <legend className="px-1 font-medium">Sound and alerts</legend>
      <div>
        <label className="flex items-center gap-2.5"><input type="checkbox" checked={settings.soundEnabled} onChange={(e) => update({ soundEnabled: e.target.checked })} />Play a sound for new notifications</label>
        <div className="mt-2 flex items-center gap-3">
          <label htmlFor="alert-volume" className="shrink-0">Volume</label>
          <input id="alert-volume" type="range" min={0} max={100} step={5} className="min-w-0 flex-1" value={settings.soundVolume} disabled={!settings.soundEnabled} onChange={(e) => update({ soundVolume: Number(e.target.value) })} />
          <span className="w-9 text-right tabular-nums" aria-hidden>{settings.soundVolume}%</span>
          <Button size="sm" variant="secondary" onClick={test}>Test sound</Button>
        </div>
        {!ready && <p className="text-helper mt-1">Click anywhere on the page once to allow sound in this browser.</p>}
      </div>
      {state !== 'unsupported' && (
        <div>
          <label className="flex items-center gap-2.5"><input type="checkbox" checked={settings.desktopEnabled} onChange={(e) => update({ desktopEnabled: e.target.checked })} />Show desktop alerts when I am in another window or application</label>
          <p className="text-helper mt-0.5">Works while LeadPilot is open in a browser tab.</p>
          {settings.desktopEnabled && (state === 'granted' ? <p className="mt-1 text-success">Allowed in this browser.</p>
            : state === 'denied' ? <p className="text-helper mt-1">Blocked in your browser settings. Allow notifications for this site there, then reload.</p>
            : <Button size="sm" className="mt-2" onClick={() => void enableDesktop().then(setState)}>Turn on in this browser</Button>)}
        </div>
      )}
      {state === 'unsupported' && <p className="text-helper">Desktop alerts are not supported in this browser.</p>}
    </fieldset>
  );
}

function Preferences({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const terms = useTerms();
  const labels = notificationLabels(terms);
  const prefs = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: () => api<{ preferences: { type: string; inApp: boolean }[] }>('/notifications/preferences') });
  const save = useMutation({ mutationFn: (p: { type: string; inApp: boolean }) => api('/notifications/preferences', { method: 'PUT', body: { preferences: [p] } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'prefs'] }), onError: (e) => handleApiError(e) });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Notification settings" description="Choose what appears in your bell">
        <SoundAndAlerts />
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
  // Show the count in the browser tab ("(2) Inbox"), so it is visible from another tab. Re-applied on navigation because pages set their own title.
  const pathname = usePathname();
  useEffect(() => {
    const t = setTimeout(() => { document.title = withUnreadTitle(document.title, unread); }, 50);
    return () => clearTimeout(t);
  }, [unread, pathname]);
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
