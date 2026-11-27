'use client';

import { AnimatePresence, motion } from 'motion/react';
import { CalendarPlus, CheckSquare, Globe, LogOut, Megaphone, Menu, Plus, Search, UserPlus, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LeadFormDialog } from '@/components/crm/lead-form-dialog';
import { TaskDrawer } from '@/components/crm/task-drawer';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown';
import { useRealtime } from '@/hooks/use-realtime';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n-context';
import { useTerms } from '@/lib/pack';
import { useSupportSession } from '@/lib/support';
import { useSidebar } from '@/lib/sidebar-state';
import { cn } from '@/lib/cn';
import { CommandPalette } from './command-palette';
import { SidebarContent } from './sidebar';
import { NotificationBell } from './notification-bell';
import { ThemeSwitcher } from './theme-switcher';
import { WorkspaceSwitcher } from './workspace-switcher';
import { AiCapBanner } from './ai-cap-banner';
import { BillingBanner } from './billing-banner';
import { DeletionBanner } from './deletion-banner';
import { SupportBanner } from './support-banner';
import { VerifyEmailBanner } from './verify-banner';
import { HelpTourButton } from '@/components/tour/help-tour-button';
import { HelpTourProvider } from '@/components/tour/help-tour-provider';
import { TourOverlay } from '@/components/tour/tour-overlay';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <HelpTourProvider>
      <AppShellInner>{children}</AppShellInner>
      <TourOverlay />
    </HelpTourProvider>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const { ctx, can, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const terms = useTerms();
  useRealtime(true);
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle } = useSidebar();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const support = useSupportSession().data?.active === true;
  const canCreateLead = can('lead:write:own') || can('lead:write:all');
  const canCreateAppt = can('appointment:write');
  const canCreateCampaign = can('campaign:manage');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncs UI state after mount or when the dialog/query input changes
    setMounted(true);
  }, []);

  const isFullBleed = pathname === '/inbox' || pathname.startsWith('/inbox');

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <motion.aside
        className="hidden shrink-0 lg:block"
        initial={false}
        animate={{ width: collapsed ? 64 : 248 }}
        transition={mounted ? { duration: 0.2, ease: [0.2, 0, 0, 1] } : { duration: 0 }}
      >
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
          <button onClick={() => setPaletteOpen(true)} className="ml-2 hidden h-9 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] text-muted-foreground hover:border-border-strong md:flex" aria-label="Search or jump to… ⌘K">
            <Search className="h-4 w-4" aria-hidden /><span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}><Search className="h-4 w-4" /></Button>
            {!support ? (
              <Dropdown
                trigger={
                  <Button variant="ghost" size="icon" aria-label="Quick create" title="Quick create">
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                }
              >
                <DropdownLabel>Quick create</DropdownLabel>
                {canCreateLead ? (
                  <DropdownItem onSelect={() => setLeadDialogOpen(true)}>
                    <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden />
                    New {terms.lead.toLowerCase()}
                  </DropdownItem>
                ) : null}
                <DropdownItem onSelect={() => setTaskDrawerOpen(true)}>
                  <CheckSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
                  New task
                </DropdownItem>
                {canCreateAppt ? (
                  <DropdownItem asChild>
                    <Link href="/appointments">
                      <CalendarPlus className="h-4 w-4 text-muted-foreground" aria-hidden />
                      Book {terms.visit.toLowerCase()}
                    </Link>
                  </DropdownItem>
                ) : null}
                {canCreateCampaign ? (
                  <DropdownItem asChild>
                    <Link href="/campaigns">
                      <Megaphone className="h-4 w-4 text-muted-foreground" aria-hidden />
                      New campaign
                    </Link>
                  </DropdownItem>
                ) : null}
              </Dropdown>
            ) : null}
            <NotificationBell />
            <HelpTourButton />
            <ThemeSwitcher />
            <Dropdown trigger={<button aria-label="Account menu" className="ml-1 flex h-10 w-10 items-center justify-center rounded-full lg:h-auto lg:w-auto"><Avatar name={ctx.user.name} size={30} /></button>}>
              <div className="px-2.5 py-2"><p className="text-[13px] font-medium">{ctx.user.name}</p><p className="text-helper">{ctx.user.email}</p></div>
              <DropdownSeparator />
              <DropdownLabel>{t('shell.account')}</DropdownLabel>
              {support ? null : <DropdownItem asChild><Link href="/settings"><UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />{t('common.settings')}</Link></DropdownItem>}
              <DropdownItem onSelect={() => setLocale(locale === 'en' ? 'hi' : 'en')}>
                <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t('common.language')}: {locale === 'en' ? 'English → हिन्दी' : 'हिन्दी → English'}
              </DropdownItem>
              <DropdownItem onSelect={() => void logout()}><LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />{t('common.signOut')}</DropdownItem>
            </Dropdown>
          </div>
        </header>
        <SupportBanner />
        <VerifyEmailBanner />
        <DeletionBanner />
        <BillingBanner />
        <AiCapBanner />
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            'min-h-0 flex-1 focus:outline-none',
            isFullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
              className={cn(
                'w-full',
                isFullBleed
                  ? 'flex min-h-0 flex-1 flex-col'
                  : 'px-4 py-5 sm:px-6 sm:py-6'
              )}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onQuickCreate={(kind) => {
          if (kind === 'lead') setLeadDialogOpen(true);
          else setTaskDrawerOpen(true);
        }}
      />
      <LeadFormDialog
        open={leadDialogOpen}
        onOpenChange={setLeadDialogOpen}
        onCreated={(l) => router.push(`/leads/${l.id}`)}
      />
      <TaskDrawer open={taskDrawerOpen} onOpenChange={setTaskDrawerOpen} />
    </div>
  );
}
