'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Command } from 'cmdk';
import { Search, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs } from '@/lib/crm';
import { ALL_NAV, isLive, navLabel } from '@/lib/nav';
import { usePack, useTerms } from '@/lib/pack';
import { BLOCKED_DURING_SUPPORT, useSupportSession } from '@/lib/support';
import { useTheme } from '@/lib/theme';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { can, logout, activeWorkspace } = useAuth();
  const terms = useTerms();
  const pack = usePack();
  const modules = activeWorkspace?.industryChosen ? pack.modules : { properties: false };
  const { setPreference } = useTheme();
  // Modal behaviour: remember what had focus, keep Tab inside, give the dialog a name, and hand focus back on close.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null;
    if (!open && wasOpen.current) { const el = opener.current; opener.current = null; if (el && document.contains(el)) el.focus(); }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpenChange(!open); }
      if (e.key === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => { onOpenChange(false); fn(); };
  const support = useSupportSession().data?.active === true;
  const nav = ALL_NAV.filter((n) => isLive(n) && (!n.permission || can(n.permission)) && (!n.module || modules[n.module]) && !(support && BLOCKED_DURING_SUPPORT.has(n.href)));

  const [search, setSearch] = useState('');
  const q = useDebounce(search, 200);

  const leads = useQuery({
    queryKey: ['command-leads', q],
    enabled: open && q.trim().length >= 2 && (can('lead:read:all') || can('lead:read:own')),
    queryFn: () =>
      api<{ items: { id: string; name: string; phone: string | null; email: string | null; stage: { name: string } }[] }>(
        `/leads${qs({ q: q.trim(), pageSize: 5 })}`
      ),
  });

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={(e) => { if (e.key === 'Tab') e.preventDefault(); }}>
          <motion.div className="absolute inset-0 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} onClick={() => onOpenChange(false)} />
          <motion.div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-lg" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}>
            <Command label="Search pages and actions" loop>
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
                <Command.Input
                  autoFocus
                  value={search}
                  onValueChange={setSearch}
                  placeholder={`Search pages, actions, or ${terms.leads.toLowerCase()}…`}
                  className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
                />
                <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
              </div>
              <Command.List className="max-h-80 overflow-auto p-2">
                <Command.Empty className="py-8 text-center text-[13px] text-muted-foreground">No results.</Command.Empty>

                {leads.data?.items && leads.data.items.length > 0 ? (
                  <Command.Group
                    heading={terms.Leads}
                    className="[&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {leads.data.items.map((lead) => (
                      <Command.Item
                        key={lead.id}
                        value={`Lead ${lead.name} ${lead.phone ?? ''} ${lead.email ?? ''}`}
                        onSelect={() => run(() => router.push(`/leads/${lead.id}`))}
                        className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-[13px] data-[selected=true]:bg-muted"
                      >
                        <div className="flex items-center gap-2.5">
                          <User className="h-4 w-4 text-primary" aria-hidden />
                          <span className="font-medium text-foreground">{lead.name}</span>
                          <span className="text-muted-foreground text-[12px]">{lead.phone ?? lead.email}</span>
                        </div>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {lead.stage.name}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null}

                <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground">
                  {nav.map((n) => (
                    <Command.Item key={n.href} value={navLabel(n, terms)} onSelect={() => run(() => router.push(n.href))} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-[13px] data-[selected=true]:bg-muted">
                      <n.icon className="h-4 w-4 text-muted-foreground" aria-hidden />{navLabel(n, terms)}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Preferences" className="[&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground">
                  {(['light', 'dark', 'system'] as const).map((t) => (
                    <Command.Item key={t} value={`Theme ${t}`} onSelect={() => run(() => setPreference(t))} className="cursor-pointer rounded-md px-2 py-2 text-[13px] capitalize data-[selected=true]:bg-muted">Switch to {t} theme</Command.Item>
                  ))}
                  <Command.Item value="Sign out" onSelect={() => run(() => void logout())} className="cursor-pointer rounded-md px-2 py-2 text-[13px] data-[selected=true]:bg-muted">Sign out</Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
