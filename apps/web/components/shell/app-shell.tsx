'use client';

import { AnimatePresence, motion } from 'motion/react';
import { LogOut, Menu, Search, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown';
import { useAuth } from '@/lib/auth';
import { CommandPalette } from './command-palette';
import { SidebarContent } from './sidebar';
import { ThemeSwitcher } from './theme-switcher';
import { WorkspaceSwitcher } from './workspace-switcher';
import { VerifyEmailBanner } from './verify-banner';

const STORAGE_KEY = 'lp-sidebar-collapsed';

export function AppShell({ children }: { children: ReactNode }) {
  const { ctx, logout } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Restore the persisted sidebar state after hydration (reading storage during render would cause a hydration mismatch).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setCollapsed(localStorage.getItem(STORAGE_KEY) === '1'); } catch { /* ignore */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(STORAGE_KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; });

  return (
    <div className="flex h-dvh overflow-hidden">
      <motion.aside className="hidden shrink-0 lg:block" initial={false} animate={{ width: collapsed ? 64 : 248 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
        <SidebarContent collapsed={collapsed} onToggle={toggle} />
      </motion.aside>

      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div className="absolute inset-0 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside className="absolute inset-y-0 left-0 w-72" initial={{ x: -288 }} animate={{ x: 0 }} exit={{ x: -288 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}>
              <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute right-3 top-3.5 rounded-md p-1 text-sidebar-muted hover:text-white"><X className="h-5 w-5" /></button>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-header px-3 sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></Button>
          <WorkspaceSwitcher />
          <button onClick={() => setPaletteOpen(true)} className="ml-2 hidden h-9 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] text-muted-foreground hover:border-border-strong md:flex" aria-label="Open command palette">
            <Search className="h-4 w-4" aria-hidden /><span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}><Search className="h-4 w-4" /></Button>
            <ThemeSwitcher />
            <Dropdown trigger={<button aria-label="Account menu" className="ml-1 rounded-full"><Avatar name={ctx.user.name} size={30} /></button>}>
              <div className="px-2.5 py-2"><p className="text-[13px] font-medium">{ctx.user.name}</p><p className="text-helper">{ctx.user.email}</p></div>
              <DropdownSeparator />
              <DropdownLabel>Account</DropdownLabel>
              <DropdownItem asChild><Link href="/settings"><UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />Settings</Link></DropdownItem>
              <DropdownItem onSelect={() => void logout()}><LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />Sign out</DropdownItem>
            </Dropdown>
          </div>
        </header>
        <VerifyEmailBanner />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }} className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-6">
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
