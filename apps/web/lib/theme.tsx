'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'lp-theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Inline script executed before first paint (injected in <head>) so the correct class is on <html>
 * before React hydrates: this is what prevents a flash of the wrong theme.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${STORAGE_KEY}')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  const apply = useCallback((p: ThemePreference) => {
    const dark = p === 'dark' || (p === 'system' && systemDark());
    document.documentElement.classList.toggle('dark', dark);
    setResolved(dark ? 'dark' : 'light');
  }, []);

  // Initial preference is read after hydration (the inline head script already applied the class, so there is no flash).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const p = readPreference();
    setPref(p);
    apply(p);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (readPreference() === 'system') apply('system'); };
    mq.addEventListener('change', onChange);
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) { const n = readPreference(); setPref(n); apply(n); } };
    window.addEventListener('storage', onStorage);
    return () => { mq.removeEventListener('change', onChange); window.removeEventListener('storage', onStorage); };
  }, [apply]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setPreference = useCallback((p: ThemePreference) => {
    try { localStorage.setItem(STORAGE_KEY, p); } catch { /* storage unavailable: theme still applies for this session */ }
    setPref(p);
    apply(p);
  }, [apply]);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
