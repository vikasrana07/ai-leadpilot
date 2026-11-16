'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { API_URL } from '@/lib/api';

/**
 * Subscribes to the server-sent event stream and invalidates the affected queries. Events carry only ids; the data is
 * refetched through the normal (permission-checked) API. Reconnects with backoff; the browser also retries on its own.
 */
export function useRealtime(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

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
      es.onopen = () => { retry = 0; };
      es.addEventListener('notification.created', () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); void qc.invalidateQueries({ queryKey: ['tasks'] }); void qc.invalidateQueries({ queryKey: ['appointments'] }); });
      for (const type of ['message.created', 'message.status', 'conversation.updated']) {
        es.addEventListener(type, (e) => { try { refresh((JSON.parse((e as MessageEvent<string>).data) as { conversationId?: string }).conversationId); } catch { refresh(); } });
      }
      es.onerror = () => {
        es?.close();
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry));
      };
    };
    connect();
    return () => { closed = true; es?.close(); if (timer) clearTimeout(timer); };
  }, [enabled, qc]);
}
