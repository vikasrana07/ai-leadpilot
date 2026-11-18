'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { API_URL, api } from '@/lib/api';
import type { Notification } from '@/lib/ops';
import { parseLive, shouldToast, showDesktop } from '@/lib/alerts';

/**
 * Subscribes to the server-sent event stream and invalidates the affected queries. Events carry only ids; the data is
 * refetched through the normal (permission-checked) API. Reconnects with backoff; the browser also retries on its own.
 * A notification that arrives live also pops up (and, if the person allowed it and the tab is in the background, becomes a desktop alert),
 * so something that happens while they are on another page or tab is not missed.
 */
export function useRealtime(enabled: boolean): void {
  const qc = useQueryClient();
  const router = useRouter(); const pathname = usePathname();
  // The listener is created once; it reads the latest page and router through a ref instead of reconnecting on every navigation.
  const where = useRef({ router, pathname });
  useEffect(() => { where.current = { router, pathname }; }, [router, pathname]);
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lostAt: number | null = null; // when the live connection dropped, so what arrived meanwhile can be announced after it comes back
    const announced = new Set<string>(); // notification ids already shown, so a pop-up never repeats

    const refresh = (conversationId?: string) => {
      void qc.invalidateQueries({ queryKey: ['conversations', 'list'] });
      void qc.invalidateQueries({ queryKey: ['conversations', 'unread'] });
      if (conversationId) {
        void qc.invalidateQueries({ queryKey: ['conversations', 'messages', conversationId] });
        void qc.invalidateQueries({ queryKey: ['conversations', 'detail', conversationId] });
      }
    };
    const connect = () => {
      es = new EventSource(`${API_URL}/realtime/stream`, { withCredentials: true });
      es.onopen = () => {
        retry = 0;
        const since = lostAt; lostAt = null;
        if (since === null) return;
        // The connection was down (a deploy, a restart, the network): anything created meanwhile never came through the stream. Announce what is still unread.
        void api<{ items: Notification[] }>('/notifications?limit=15&unread=true').then((r) => {
          void qc.invalidateQueries({ queryKey: ['notifications'] });
          for (const x of r.items) {
            if (x.read || announced.has(x.id) || new Date(x.createdAt).getTime() < since - 5000) continue;
            announced.add(x.id);
            const n = { id: x.id, type: x.type, title: x.title, body: x.body, link: x.link };
            if (shouldToast(n, where.current.pathname, document.hidden)) toast(n.title, { ...(n.body ? { description: n.body } : {}), ...(n.link ? { action: { label: 'Open', onClick: () => { if (n.link) where.current.router.push(n.link); } } } : {}), duration: 8000 });
            showDesktop(n, (link) => { if (link) where.current.router.push(link); });
          }
        }).catch(() => undefined);
      };
      es.addEventListener('notification.created', (e) => {
        void qc.invalidateQueries({ queryKey: ['notifications'] }); void qc.invalidateQueries({ queryKey: ['tasks'] }); void qc.invalidateQueries({ queryKey: ['appointments'] });
        const n = parseLive((e as MessageEvent<string>).data);
        if (!n) return;
        if (n.id) { if (announced.has(n.id)) return; announced.add(n.id); }
        const open = (link: string | null) => { if (link) where.current.router.push(link); };
        if (shouldToast(n, where.current.pathname, document.hidden)) toast(n.title, { ...(n.body ? { description: n.body } : {}), ...(n.link ? { action: { label: 'Open', onClick: () => open(n.link ?? null) } } : {}), duration: 8000 });
        showDesktop(n, open);
      });
      for (const type of ['message.created', 'message.status', 'conversation.updated']) {
        es.addEventListener(type, (e) => { try { refresh((JSON.parse((e as MessageEvent<string>).data) as { conversationId?: string }).conversationId); } catch { refresh(); } });
      }
      es.onerror = () => {
        es?.close();
        lostAt ??= Date.now();
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry));
      };
    };
    connect();
    return () => { closed = true; es?.close(); if (timer) clearTimeout(timer); };
  }, [enabled, qc]);
}
