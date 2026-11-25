'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Edit, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RoleBuilderDialog, type RoleData } from '@/components/roles/role-builder-dialog';

export default function RolesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canManageRoles = can('role:manage');

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleData | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleData | null>(null);

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<RoleData[]>('/roles'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Role deleted successfully');
      void qc.invalidateQueries({ queryKey: ['roles'] });
      setDeletingRole(null);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Failed to delete role');
    },
  });

  const handleCreate = () => {
    setEditingRole(null);
    setBuilderOpen(true);
  };

  const handleEdit = (r: RoleData) => {
    setEditingRole(r);
    setBuilderOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Configure granular access profiles. System roles provide standard baselines, while custom roles allow tailored privilege delegation."
        actions={
          canManageRoles ? (
            <Button data-tour="roles-create" variant="primary" onClick={handleCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              Create custom role
            </Button>
          ) : undefined
        }
      />

      {roles.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="flex flex-col justify-between p-5 space-y-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3.5 w-48" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full shrink-0" />
                </div>
                <Skeleton className="h-4 w-24" />
                <div className="space-y-2 border-t border-border/50 pt-3">
                  <Skeleton className="h-3 w-28 font-medium" />
                  {Array.from({ length: 3 }).map((_, p) => (
                    <div key={p} className="flex items-center gap-2">
                      <Skeleton className="h-3.5 w-3.5 rounded" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
                <Skeleton className="h-8 w-16 rounded-md" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            </Card>
          ))}
        </div>
      ) : roles.isError ? (
        <p className="text-[13px] text-danger">Could not load roles.</p>
      ) : (
        <div data-tour="roles-list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.data.map((r) => {
            const groups = new Map<string, RoleData['permissions']>();
            r.permissions.forEach((p) => {
              const g = p.key.split(':')[0] ?? 'other';
              groups.set(g, [...(groups.get(g) ?? []), p]);
            });

            return (
              <Card key={r.id} className="flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate">{r.name}</CardTitle>
                    <p className="text-helper mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      key: {r.key}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {r.isSystem ? (
                      <Badge tone="neutral">System</Badge>
                    ) : (
                      <Badge tone="primary">Custom</Badge>
                    )}
                  </div>
                </CardHeader>

                <div className="flex items-center justify-between border-y border-border/60 bg-muted/20 px-5 py-2 text-[12px] text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <span className="num">{r.memberCount ?? 0}</span> member(s)
                  </span>

                  {!r.isSystem && canManageRoles ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(r)}
                        title="Edit role permissions"
                      >
                        <Edit className="h-3.5 w-3.5" aria-hidden />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:text-danger"
                        onClick={() => setDeletingRole(r)}
                        title="Delete custom role"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>

                <CardBody
                  className="max-h-[24rem] flex-1 space-y-4 overflow-y-auto"
                  tabIndex={0}
                  role="region"
                  aria-label={`${r.name} permissions`}
                >
                  <p className="text-helper num">{r.permissions.length} total permissions</p>
                  {Array.from(groups.entries()).map(([g, perms]) => (
                    <div key={g}>
                      <p className="text-label mb-1.5 capitalize text-muted-foreground">{g}</p>
                      <ul className="space-y-1">
                        {perms.map((p) => (
                          <li key={p.key} className="flex items-start gap-2 text-[13px]">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                            <span>{p.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Role Builder Modal (Create / Edit) */}
      <RoleBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        role={editingRole}
      />

      {/* Delete Confirmation Modal */}
      <Dialog
        open={Boolean(deletingRole)}
        onOpenChange={(open) => !open && setDeletingRole(null)}
      >
        <DialogContent
          title="Delete custom role"
          description={`Are you sure you want to permanently delete "${deletingRole?.name}"?`}
          size="sm"
        >
          <div className="space-y-4 pt-2">
            <p className="text-[13px] text-muted-foreground">
              This action cannot be undone. Any workspace automations or assignments referencing this role key will no longer apply.
            </p>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" onClick={() => setDeletingRole(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deletingRole && deleteMutation.mutate(deletingRole.id)}
              >
                Delete role
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
