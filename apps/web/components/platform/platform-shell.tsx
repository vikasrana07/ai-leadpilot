'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
} from '@/components/ui/dropdown';
import { ThemeSwitcher } from '@/components/shell/theme-switcher';
import { SystemStatusPill } from './system-status-pill';
import { platformApi } from '@/lib/platform';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/platform/tenants', label: 'Tenants', icon: Building2 },
  { href: '/platform/plans', label: 'Plans', icon: CreditCard },
  { href: '/platform/deletions', label: 'Deletion Requests', icon: Trash2 },
  { href: '/platform/ops', label: 'Ops Status', icon: Activity },
  { href: '/platform/audit', label: 'Audit Log', icon: FileText },
  { href: '/platform/security', label: 'Security & MFA', icon: ShieldCheck },
];

export function PlatformShell({
  children,
  admin,
  isLoading,
}: {
  children: ReactNode;
  admin?: { email: string; name: string };
  isLoading?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await platformApi('/auth/logout', { method: 'POST' }).catch(() => undefined);
      qc.clear();
      router.replace('/platform/login');
    } finally {
      setSigningOut(false);
    }
  }

  const currentItem = NAV_ITEMS.find((item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden border-r border-border bg-surface transition-all duration-200 lg:flex lg:flex-col shrink-0',
          collapsed ? 'w-[72px]' : 'w-[250px]'
        )}
      >
        {/* Brand Header */}
        <div
          className={cn(
            'flex h-14 items-center border-b border-border transition-all',
            collapsed ? 'justify-center px-0' : 'justify-between px-4'
          )}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="group relative flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs transition-opacity group-hover:opacity-20">
                <span className="text-sm font-bold tracking-tight">LP</span>
              </div>
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="h-4 w-4 text-foreground" />
              </div>
            </button>
          ) : (
            <>
              <Link
                href="/platform"
                className="flex items-center gap-2.5 overflow-hidden transition-opacity hover:opacity-90 min-w-0"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                  <span className="text-sm font-bold tracking-tight">LP</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
                    LeadPilot
                  </p>
                  <span className="inline-block text-[11px] font-medium text-primary">
                    Platform Console
                  </span>
                </div>
              </Link>
              <button
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:block transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* Navigation Items */}
        <nav
          aria-label="Platform navigation"
          className="flex-1 space-y-1 overflow-y-auto p-3"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-primary-soft text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  collapsed && 'justify-center px-2'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                  aria-hidden
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-border p-2 space-y-1.5">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex h-8 w-full items-center gap-2.5 rounded-md text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
              collapsed ? 'justify-center px-0' : 'px-2'
            )}
          >
            <ChevronsLeft
              className={cn(
                'h-4 w-4 shrink-0 transition-transform duration-200',
                collapsed && 'rotate-180'
              )}
              aria-hidden
            />
            {!collapsed && <span>Collapse sidebar</span>}
          </button>

          <div
            className={cn(
              'flex items-center gap-2 rounded-lg bg-muted/50 p-2',
              collapsed && 'justify-center p-1.5'
            )}
            title={collapsed ? `${admin?.name || 'Platform Admin'} (${admin?.email || ''})` : undefined}
          >
            <Avatar name={admin?.name ?? 'Admin'} size={28} />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-foreground">
                  {admin?.name || 'Platform Admin'}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {admin?.email}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-black/50 backdrop-blur-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="absolute inset-y-0 left-0 w-72 bg-surface shadow-2xl flex flex-col"
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            >
              <div className="flex h-14 items-center justify-between border-b border-border px-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                    LP
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">LeadPilot</p>
                    <span className="text-[11px] font-medium text-primary">
                      Platform Console
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation menu"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
                {NAV_ITEMS.map((item) => {
                  const active = item.exact
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] font-medium transition-colors',
                        active
                          ? 'bg-primary-soft text-primary font-semibold'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="border-t border-border p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar name={admin?.name ?? 'Admin'} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {admin?.name || 'Platform Admin'}
                    </p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {admin?.email}
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={handleSignOut}
                  loading={signingOut}
                >
                  <LogOut className="h-4 w-4 mr-1.5" />
                  Sign Out
                </Button>
              </div>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            {/* Breadcrumb / Title indication */}
            <div className="hidden sm:flex items-center gap-2 text-[13px]">
              <span className="text-muted-foreground">Platform</span>
              <span className="text-muted-foreground/60">/</span>
              <span className="font-medium text-foreground">
                {currentItem?.label ?? 'Dashboard'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <SystemStatusPill />
            <div className="h-4 w-px bg-border hidden sm:block" />
            <ThemeSwitcher />

            {/* Admin Avatar Dropdown */}
            <Dropdown
              trigger={
                <button
                  aria-label="Platform admin account menu"
                  className="flex items-center gap-2 rounded-full p-0.5 outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Avatar name={admin?.name ?? 'Admin'} size={30} />
                </button>
              }
            >
              <div className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-foreground">
                    {admin?.name || 'Platform Admin'}
                  </p>
                  <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    STAFF
                  </span>
                </div>
                <p className="truncate text-[12px] text-muted-foreground mt-0.5">
                  {admin?.email}
                </p>
              </div>
              <DropdownSeparator />
              <DropdownItem onSelect={() => router.push('/platform/security')}>
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>Security & MFA</span>
              </DropdownItem>
              <DropdownItem onSelect={() => router.push('/platform/audit')}>
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span>Audit Logs</span>
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem danger onSelect={handleSignOut}>
                <LogOut className="h-4 w-4" aria-hidden />
                <span>Sign Out</span>
              </DropdownItem>
            </Dropdown>
          </div>
        </header>

        {/* Content Body */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto focus:outline-none"
        >
          <div className="mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {isLoading ? (
              <div className="space-y-4 animate-pulse">
                <div className="h-8 w-48 bg-muted rounded-md" />
                <div className="h-4 w-72 bg-muted/60 rounded-md" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-4">
                  <div className="h-28 bg-muted rounded-lg" />
                  <div className="h-28 bg-muted rounded-lg" />
                  <div className="h-28 bg-muted rounded-lg" />
                  <div className="h-28 bg-muted rounded-lg" />
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
