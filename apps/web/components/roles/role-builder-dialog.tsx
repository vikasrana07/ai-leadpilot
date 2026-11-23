'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface RolePermissionItem {
  key: string;
  description: string;
  category: string;
  action: string;
}

export interface RoleData {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  memberCount?: number;
  permissions: { key: string; description: string }[];
}

interface RoleBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: RoleData | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  lead: 'Leads & Pipeline',
  conversation: 'Conversations & WhatsApp',
  appointment: 'Appointments & Scheduling',
  property: 'Property Inventory',
  pipeline: 'Pipeline Stages',
  ai: 'AI Assistant',
  knowledge: 'Knowledge Base',
  automation: 'Workflow Automations',
  analytics: 'Analytics & Reports',
  team: 'Team Management',
  role: 'Roles & RBAC',
  integration: 'Third-Party Integrations',
  billing: 'Billing & Subscriptions',
  usage: 'Usage Metrics',
  audit: 'Audit Logs',
  settings: 'Workspace Settings',
};

export function RoleBuilderDialog({ open, onOpenChange, role }: RoleBuilderDialogProps) {
  const qc = useQueryClient();
  const { ctx } = useAuth();
  const isEditing = Boolean(role && !role.isSystem);

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const userPerms = useMemo(() => new Set(ctx.permissions ?? []), [ctx.permissions]);

  // Fetch all system permissions catalogue
  const permsQuery = useQuery({
    queryKey: ['roles', 'permissions'],
    queryFn: () => api<RolePermissionItem[]>('/roles/permissions'),
    enabled: open,
  });

  // Reset form when dialog opens or role changes
  useEffect(() => {
    if (open) {
      setError(null);
      setSearch('');
      if (role) {
        setName(role.name);
        setKey(role.key);
        setSelectedKeys(new Set(role.permissions.map((p) => p.key)));
      } else {
        setName('');
        setKey('');
        setSelectedKeys(new Set());
      }
    }
  }, [open, role]);

  // Auto-slugify role key from name when creating
  const handleNameChange = (val: string) => {
    setName(val);
    if (!isEditing && (!key || key === slugify(name))) {
      setKey(slugify(val));
    }
  };

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
  }

  // Toggle single permission
  const togglePermission = (permKey: string) => {
    if (!userPerms.has(permKey)) return; // Prevent privilege escalation
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(permKey)) next.delete(permKey);
      else next.add(permKey);
      return next;
    });
  };

  // Group permissions by category
  const groupedPerms = useMemo(() => {
    const map = new Map<string, RolePermissionItem[]>();
    const list = permsQuery.data ?? [];
    const query = search.toLowerCase().trim();

    list
      .filter((p) => !query || p.description.toLowerCase().includes(query) || p.key.toLowerCase().includes(query))
      .forEach((p) => {
        const cat = p.category || 'other';
        map.set(cat, [...(map.get(cat) ?? []), p]);
      });
    return map;
  }, [permsQuery.data, search]);

  // Category select/clear
  const toggleCategory = (category: string, allSelected: boolean) => {
    const catPerms = (groupedPerms.get(category) ?? []).filter((p) => userPerms.has(p.key));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      catPerms.forEach((p) => {
        if (allSelected) next.delete(p.key);
        else next.add(p.key);
      });
      return next;
    });
  };

  // Mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Role name is required');
      if (!isEditing && !key.trim()) throw new Error('Role key is required');
      if (selectedKeys.size === 0) throw new Error('Please select at least one permission');

      const payload = {
        name: name.trim(),
        permissions: Array.from(selectedKeys),
        ...(isEditing ? {} : { key: key.trim().toLowerCase() }),
      };

      if (isEditing && role) {
        return api(`/roles/${role.id}`, { method: 'PATCH', body: payload });
      }
      return api('/roles', { method: 'POST', body: payload });
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Role updated successfully' : 'Custom role created successfully');
      void qc.invalidateQueries({ queryKey: ['roles'] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      setError(err?.message ?? 'Failed to save role');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEditing ? `Edit role: ${role?.name}` : 'Create custom role'}
        description="Define a tailor-made permission profile with granular access rights."
        size="lg"
      >
        <div className="space-y-4">
          {error ? <FormErrorAlert errors={{ root: { message: error } }} /> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Role Name" htmlFor="role-name" hint="e.g. Lead Qualification Specialist">
              <Input
                id="role-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Property Consultant"
                autoFocus
              />
            </Field>

            <Field
              label="Role Key"
              htmlFor="role-key"
              hint={isEditing ? 'Key cannot be changed after creation' : 'Unique identifier (a-z, 0-9, _)'}
            >
              <Input
                id="role-key"
                value={key}
                onChange={(e) => setKey(slugify(e.target.value))}
                placeholder="e.g. property_consultant"
                disabled={isEditing}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              <span className="text-[13px] font-medium">Permissions Matrix</span>
              <span className="text-helper num">
                ({selectedKeys.size} selected)
              </span>
            </div>

            <div className="relative w-48 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <input
                type="text"
                placeholder="Filter permissions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[12px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div
            className="max-h-[22rem] space-y-4 overflow-y-auto rounded-md border border-border/80 bg-surface/50 p-3"
            tabIndex={0}
            role="region"
            aria-label="Permissions checklist"
          >
            {permsQuery.isPending ? (
              <p className="py-8 text-center text-helper">Loading permissions catalogue...</p>
            ) : groupedPerms.size === 0 ? (
              <p className="py-8 text-center text-helper">No permissions match your filter.</p>
            ) : (
              Array.from(groupedPerms.entries()).map(([cat, perms]) => {
                const grantablePerms = perms.filter((p) => userPerms.has(p.key));
                const allSelected = grantablePerms.length > 0 && grantablePerms.every((p) => selectedKeys.has(p.key));
                const someSelected = grantablePerms.some((p) => selectedKeys.has(p.key));

                return (
                  <div key={cat} className="space-y-2 rounded-md border border-border/60 bg-surface p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {CATEGORY_LABELS[cat] ?? cat}
                      </span>
                      {grantablePerms.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleCategory(cat, allSelected)}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          {allSelected ? 'Deselect all' : someSelected ? 'Select all' : 'Select category'}
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {perms.map((p) => {
                        const canGrant = userPerms.has(p.key);
                        const isChecked = selectedKeys.has(p.key);

                        return (
                          <label
                            key={p.key}
                            className={`flex cursor-pointer select-none items-start gap-2 rounded px-2 py-1.5 text-[12px] transition-colors ${
                              !canGrant
                                ? 'cursor-not-allowed opacity-50'
                                : isChecked
                                  ? 'bg-primary/5 text-foreground'
                                  : 'hover:bg-muted/40 text-muted-foreground'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={!canGrant}
                              onChange={() => togglePermission(p.key)}
                              className="mt-0.5 h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                            />
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-foreground">{p.description}</span>
                              <span className="block truncate text-[10px] text-muted-foreground">{p.key}</span>
                            </div>
                            {!canGrant ? (
                              <span title="You cannot grant permissions you do not hold">
                                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {isEditing ? 'Save changes' : 'Create role'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
