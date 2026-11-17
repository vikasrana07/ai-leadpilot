'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Warns before unsaved work is lost: the browser's own prompt for reload/close, and an in-app dialog for clicks on links inside the app.
 * The browser Back button is deliberately not intercepted (Next's router has no safe hook for it); the editor keeps a draft in
 * sessionStorage and offers to restore it, so a stray Back loses nothing.
 */
export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const leaving = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault(); e.stopPropagation();
      setPending(`${url.pathname}${url.search}${url.hash}`);
    };
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBefore);
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('beforeunload', onBefore); };
  }, [dirty]);
  return (
    <ConfirmDialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null); }} danger title="Leave without saving?" description="You have changes that are not saved. A draft stays in this browser tab, but it is lost when you close the tab." confirmLabel="Leave without saving"
      onConfirm={async () => { const href = pending; leaving.current = true; if (href) router.push(href); }} />
  );
}
