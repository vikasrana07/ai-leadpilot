import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { ThemeSwitcher } from '@/components/shell/theme-switcher';
import { cn } from '@/lib/cn';

const TABS = [{ href: '/design/inbox', label: 'Inbox' }, { href: '/design/lead', label: 'Lead detail' }, { href: '/design/pipeline', label: 'Pipeline' }];

/** Wraps design-review screens. They use hard-coded SAMPLE data and are NOT connected to the backend. */
export function PreviewFrame({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <div role="note" className="flex flex-wrap items-center gap-x-3 border-b border-border bg-warning-soft px-4 py-1.5 text-[12px] text-warning">
        <strong>Design preview</strong><span>Sample data only. Not connected to any backend. Real screens ship in phases 2 and 3.</span>
      </div>
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-border bg-surface px-4">
        <Logo />
        <nav className="flex gap-1" aria-label="Design previews">
          {TABS.map((t) => <Link key={t.href} href={t.href} aria-current={t.href === active ? 'page' : undefined} className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium', t.href === active ? 'bg-primary-soft text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}>{t.label}</Link>)}
        </nav>
        <div className="ml-auto"><ThemeSwitcher /></div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
