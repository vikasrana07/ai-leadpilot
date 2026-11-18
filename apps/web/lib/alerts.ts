/**
 * Live alerts: what the app does when a notification arrives while the person is working somewhere else. Pure helpers (no React) so the
 * decisions are unit-tested; the hooks that use them are in hooks/use-realtime.ts and components/shell/notification-bell.tsx.
 */
export interface LiveNotification { id?: string; type?: string; title?: string; body?: string | null; link?: string | null }

/** Reads the server-sent event payload. Anything unusable is ignored, never thrown. */
export function parseLive(data: string): LiveNotification | null {
  try {
    const d = JSON.parse(data) as Record<string, unknown>;
    if (!d || typeof d !== 'object' || typeof d.title !== 'string' || d.title.length === 0) return null;
    return { ...(typeof d.id === 'string' ? { id: d.id } : {}), ...(typeof d.type === 'string' ? { type: d.type } : {}), title: d.title, body: typeof d.body === 'string' ? d.body : null, link: typeof d.link === 'string' && /^\/(?![/\\])/.test(d.link) ? d.link : null };
  } catch { return null; }
}

/** Show a pop-up for every notification, except that a new-message pop-up is pointless while the person is already looking at the Inbox. */
export function shouldToast(n: LiveNotification, pathname: string, tabHidden: boolean): boolean {
  if (!n.title) return false;
  if (n.type === 'new_message' && pathname.startsWith('/inbox') && !tabHidden) return false;
  return true;
}

/** "(3) Dashboard" in the browser tab, so a person on another tab sees something arrived. Idempotent: strips an earlier prefix first. */
export function withUnreadTitle(title: string, unread: number): string {
  const clean = title.replace(/^\(\d+\+?\)\s*/, '');
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${clean}` : clean;
}

export type DesktopState = 'unsupported' | 'default' | 'granted' | 'denied';
export function desktopState(): DesktopState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}
/** Must be called from a click. Returns the resulting state. */
export async function enableDesktop(): Promise<DesktopState> {
  if (desktopState() === 'unsupported') return 'unsupported';
  try { await Notification.requestPermission(); } catch { /* older browsers use a callback form; the state below is authoritative */ }
  return desktopState();
}
/** A system notification, only when permission was given and the tab is not in front (the pop-up covers the in-front case). */
export function showDesktop(n: LiveNotification, onOpen: (link: string | null) => void): void {
  if (desktopState() !== 'granted' || !n.title || !document.hidden) return;
  try {
    const x = new Notification(n.title, { ...(n.body ? { body: n.body } : {}), ...(n.id ? { tag: n.id } : {}) });
    x.onclick = () => { window.focus(); onOpen(n.link ?? null); x.close(); };
  } catch { /* some browsers refuse outside a service worker; the in-app pop-up still works */ }
}
