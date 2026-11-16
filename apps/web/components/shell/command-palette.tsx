'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { ALL_NAV, isLive } from '@/lib/nav';
import { useTheme } from '@/lib/theme';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { can, logout } = useAuth();
  const { setPreference } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpenChange(!open); }
      if (e.key === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => { onOpenChange(false); fn(); };
  const nav = ALL_NAV.filter((n) => isLive(n) && (!n.permission || can(n.permission)));

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]" role="presentation">
          <motion.div className="absolute inset-0 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} onClick={() => onOpenChange(false)} />
          <motion.div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-lg" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}>
            <Command label="Command palette" loop>
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
                <Command.Input autoFocus placeholder="Search pages and actions…" className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
                <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
              </div>
              <Command.List className="max-h-80 overflow-auto p-2">
                <Command.Empty className="py-8 text-center text-[13px] text-muted-foreground">No results.</Command.Empty>
                <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground">
                  {nav.map((n) => (
                    <Command.Item key={n.href} value={n.label} onSelect={() => run(() => router.push(n.href))} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-[13px] data-[selected=true]:bg-muted">
                      <n.icon className="h-4 w-4 text-muted-foreground" aria-hidden />{n.label}
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
