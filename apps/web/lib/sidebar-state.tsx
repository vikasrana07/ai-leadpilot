'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export const SIDEBAR_STORAGE_KEY = 'lp-sidebar-collapsed';

export const SIDEBAR_INIT_SCRIPT = `(function(){try{var c=document.cookie.match(/lp-sidebar-collapsed=([^;]+)/);var v=c?c[1].trim():localStorage.getItem('${SIDEBAR_STORAGE_KEY}');if(v==='1'){document.documentElement.classList.add('sidebar-collapsed');document.documentElement.style.setProperty('--sidebar-width','64px');}else{document.documentElement.classList.remove('sidebar-collapsed');document.documentElement.style.setProperty('--sidebar-width','248px');}}catch(e){}})();`;

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({
  initialCollapsed = false,
  children,
}: {
  initialCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) {
        const isCol = stored === '1';
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncs UI state after mount or when the dialog/query input changes
        setCollapsedState(isCol);
        document.documentElement.classList.toggle('sidebar-collapsed', isCol);
        document.documentElement.style.setProperty('--sidebar-width', isCol ? '64px' : '248px');
        document.cookie = `lp-sidebar-collapsed=${isCol ? '1' : '0'}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
        document.cookie = `lp-sidebar-collapsed=${next ? '1' : '0'}; path=/; max-age=31536000; SameSite=Lax`;
        document.documentElement.classList.toggle('sidebar-collapsed', next);
        document.documentElement.style.setProperty('--sidebar-width', next ? '64px' : '248px');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const setCollapsed = (v: boolean | ((prev: boolean) => boolean)) => {
    setCollapsedState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
        document.cookie = `lp-sidebar-collapsed=${next ? '1' : '0'}; path=/; max-age=31536000; SameSite=Lax`;
        document.documentElement.classList.toggle('sidebar-collapsed', next);
        document.documentElement.style.setProperty('--sidebar-width', next ? '64px' : '248px');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return ctx;
}
