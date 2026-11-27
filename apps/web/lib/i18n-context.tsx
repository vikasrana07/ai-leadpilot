'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import en from '@/messages/en.json';
import hi from '@/messages/hi.json';

export type Locale = 'en' | 'hi';
export type TranslationKey = keyof typeof en;

const MESSAGES: Record<Locale, Record<string, string>> = { en, hi };
const STORAGE_KEY = 'lp_locale';

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => en[key],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en';
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'hi' ? 'hi' : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  const t = (key: TranslationKey, vars?: Record<string, string | number>) => {
    let str = MESSAGES[locale]?.[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
