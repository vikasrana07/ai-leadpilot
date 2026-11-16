'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';

/**
 * Bot check for public forms (Cloudflare Turnstile). Off unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set at build time.
 * The special value `mock` (dev/test; the API must run TURNSTILE_MODE=mock) supplies the mock token without loading anything.
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
export const BOT_HEADER = 'x-turnstile-token';

interface TurnstileApi { render(el: HTMLElement, o: Record<string, unknown>): string; reset(id: string): void; remove(id: string): void }
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptPromise: Promise<TurnstileApi> | null = null;
function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable')));
    s.onerror = () => { scriptPromise = null; reject(new Error('Could not load the verification check')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** `widget` goes inside the form; `getToken()` resolves with the token to send as the `x-turnstile-token` header (undefined when the check is off). */
export function useBotCheck(): { enabled: boolean; widget: ReactNode; getToken: () => Promise<string | undefined>; reset: () => void } {
  const holder = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const live = !!SITE_KEY && SITE_KEY !== 'mock';

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void loadScript().then((ts) => {
      if (cancelled || !holder.current || widgetId.current) return;
      widgetId.current = ts.render(holder.current, { sitekey: SITE_KEY, callback: (t: string) => { token.current = t; }, 'expired-callback': () => { token.current = null; }, 'error-callback': () => { token.current = null; } });
    }).catch(() => undefined);
    return () => { cancelled = true; if (widgetId.current && window.turnstile) { window.turnstile.remove(widgetId.current); widgetId.current = null; } };
  }, [live]);

  const reset = useCallback(() => { token.current = null; if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current); }, []);
  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!SITE_KEY) return undefined;
    if (SITE_KEY === 'mock') return 'mock-pass';
    for (let i = 0; i < 150 && !token.current; i++) await new Promise((r) => setTimeout(r, 200)); // up to 30 s for the challenge
    const t = token.current ?? undefined;
    token.current = null; // single use
    return t;
  }, []);

  return { enabled: !!SITE_KEY, widget: live ? <div ref={holder} className="min-h-[65px]" aria-label="Verification" /> : null, getToken, reset };
}
