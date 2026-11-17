'use client';

import { packForIndustry } from '@leadpilot/shared-types';
import { motion } from 'motion/react';
import { ChevronsLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { Tooltip } from '@/components/ui/tooltip';
import { useAuth } from '@/lib/auth';
import { useUnreadCount } from '@/lib/inbox';
import { cn } from '@/lib/cn';
import { BLOCKED_DURING_SUPPORT, useSupportSession } from '@/lib/support';
import { ADMIN_NAV, isLive, WORKSPACE_NAV, type NavItem } from '@/lib/nav';

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const unread = useUnreadCount(item.href === '/inbox');
  const badge = item.href === '/inbox' && (unread.data ?? 0) > 0 ? unread.data : null;
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const soon = !isLive(item);
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn('relative flex h-10 items-center lg:h-9 gap-3 rounded-md px-2.5 text-[13px] font-medium transition-colors', active ? 'text-white' : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white', collapsed && 'justify-center px-0')}
    >
      {active ? <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-sidebar-accent ring-1 ring-sidebar-border" transition={{ type: 'spring', stiffness: 500, damping: 40 }} /> : null}
      {active ? <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" aria-hidden /> : null}
      <item.icon className="relative h-4 w-4 shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">{item.label}</span> : (
        <>
          <span className="relative flex-1 truncate">{item.label}</span>
          {soon ? <span className="relative rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-muted">Soon</span> : null}
          {badge ? <span aria-label={`${badge} unread`} className="num relative rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{badge > 99 ? '99+' : badge}</span> : null}
        </>
      )}
    </Link>
  );
  return collapsed ? <Tooltip label={item.label}>{link}</Tooltip> : link;
}

export function SidebarContent({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const { can, activeWorkspace } = useAuth();
  const modules = activeWorkspace?.industryChosen ? packForIndustry(activeWorkspace.industryPackId).modules : { properties: false };
  const support = useSupportSession().data?.active === true;
  const admin = ADMIN_NAV.filter((i) => (!i.permission || can(i.permission)) && !(support && BLOCKED_DURING_SUPPORT.has(i.href)));
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-14 shrink-0 items-center border-b border-sidebar-border px-4', collapsed && 'justify-center px-0')}><Logo tone="light" collapsed={collapsed} /></div>
      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">{WORKSPACE_NAV.filter((i) => (!i.permission || can(i.permission)) && (!i.module || modules[i.module])).map((i) => <li key={i.href}><NavLink item={i} collapsed={collapsed} onNavigate={onNavigate} /></li>)}</ul>
        <div>
          {collapsed ? <div className="mx-2 mb-2 h-px bg-sidebar-border" /> : <p className="text-label mb-2 px-2.5 !text-sidebar-muted">Administration</p>}
          <ul className="space-y-0.5">{admin.map((i) => <li key={i.href}><NavLink item={i} collapsed={collapsed} onNavigate={onNavigate} /></li>)}</ul>
        </div>
      </nav>
      {onToggle ? (
        <div className="border-t border-sidebar-border p-3">
          <button onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={cn('flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-[13px] text-sidebar-muted hover:bg-sidebar-accent hover:text-white', collapsed && 'justify-center px-0')}>
            <ChevronsLeft className={cn('h-4 w-4 transition-transform duration-200', collapsed && 'rotate-180')} aria-hidden />
            {collapsed ? null : 'Collapse'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
