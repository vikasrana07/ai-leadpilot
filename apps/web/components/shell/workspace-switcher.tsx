'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/dropdown';
import { useAuth } from '@/lib/auth';

export function WorkspaceSwitcher() {
  const { ctx, activeWorkspace, switchWorkspace } = useAuth();
  const name = activeWorkspace?.name ?? 'Workspace';
  return (
    <Dropdown align="start" className="min-w-64" trigger={
      <button className="flex max-w-56 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted" aria-label="Switch workspace">
        <Avatar name={name} size={24} />
        <span className="truncate text-[13px] font-medium">{name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    }>
      <DropdownLabel>Workspaces</DropdownLabel>
      {ctx.workspaces.map((w) => (
        <DropdownItem key={w.tenantId} onSelect={() => { if (w.tenantId !== ctx.activeTenantId) switchWorkspace(w.tenantId).catch(() => toast.error('Could not switch workspace')); }}>
          <Avatar name={w.name} size={20} />
          <span className="flex-1 truncate">{w.name}</span>
          <span className="text-helper">{w.roleName}</span>
          {w.tenantId === ctx.activeTenantId ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
