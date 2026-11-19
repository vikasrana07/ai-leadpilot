'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PROPERTY_STATUSES } from '@leadpilot/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ImportDialog } from '@/components/crm/import-dialog';
import { PageHeader } from '@/components/page/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, FormErrorAlert } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs } from '@/lib/crm';
import { formatINR } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface Property {
  id: string;
  project: string;
  unitLabel: string | null;
  title: string;
  propertyType: string;
  bedrooms: number | null;
  areaSqft: number | null;
  price: number;
  location: string;
  status: 'AVAILABLE' | 'HELD' | 'SOLD';
}

const TONE = { AVAILABLE: 'success', HELD: 'warning', SOLD: 'neutral' } as const;

const propertyFormSchema = z.object({
  project: z.string().trim().min(1, 'Project name is required').max(100),
  unitLabel: z.string().trim().max(40).optional(),
  title: z.string().trim().max(140).optional(),
  propertyType: z.string().trim().min(1, 'Property type is required').max(60),
  location: z.string().trim().min(1, 'Location is required').max(140),
  bedrooms: z.string().optional(),
  areaSqft: z.string().optional(),
  price: z.string().trim().min(1, 'Price is required'),
  status: z.enum(['AVAILABLE', 'HELD', 'SOLD']),
});

type PropertyFormValues = z.infer<typeof propertyFormSchema>;

const BLANK_PROPERTY: PropertyFormValues = {
  project: '',
  unitLabel: '',
  title: '',
  propertyType: 'Apartment',
  bedrooms: '',
  areaSqft: '',
  price: '',
  location: '',
  status: 'AVAILABLE',
};

function PropertyDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: Property | null;
}) {
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: BLANK_PROPERTY,
  });

  useEffect(() => {
    if (open) {
      if (existing) {
        reset({
          project: existing.project,
          unitLabel: existing.unitLabel ?? '',
          title: existing.title,
          propertyType: existing.propertyType,
          bedrooms: existing.bedrooms?.toString() ?? '',
          areaSqft: existing.areaSqft?.toString() ?? '',
          price: existing.price.toString(),
          location: existing.location,
          status: existing.status,
        });
      } else {
        reset(BLANK_PROPERTY);
      }
    }
  }, [open, existing, reset]);

  const onSubmit = async (values: PropertyFormValues) => {
    const body = {
      project: values.project,
      unitLabel: values.unitLabel || null,
      title: values.title || `${values.project} ${values.unitLabel || ''}`.trim(),
      propertyType: values.propertyType,
      bedrooms: values.bedrooms ? Number(values.bedrooms) : null,
      areaSqft: values.areaSqft ? Number(values.areaSqft) : null,
      price: Number(values.price.replace(/,/g, '')),
      location: values.location,
      status: values.status,
    };

    try {
      await api(existing ? `/properties/${existing.id}` : '/properties', {
        method: existing ? 'PATCH' : 'POST',
        body,
      });
      toast.success(existing ? 'Property updated' : 'Property added');
      await qc.invalidateQueries({ queryKey: ['properties'] });
      onOpenChange(false);
    } catch (e) {
      handleApiError(e, setError);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={existing ? 'Edit property' : 'Add property'} size="2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormErrorAlert errors={errors} />
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Project *" htmlFor="p-project" error={errors.project?.message}>
              <Input id="p-project" autoFocus {...register('project')} />
            </Field>
            <Field label="Unit" htmlFor="p-unit" error={errors.unitLabel?.message}>
              <Input id="p-unit" placeholder="A-1204" {...register('unitLabel')} />
            </Field>
            <Field
              label="Title"
              htmlFor="p-title"
              error={errors.title?.message}
              className="sm:col-span-2"
              hint="Defaults to project and unit."
            >
              <Input id="p-title" {...register('title')} />
            </Field>
            <Field label="Type *" htmlFor="p-type" error={errors.propertyType?.message}>
              <Input id="p-type" {...register('propertyType')} />
            </Field>
            <Field label="Location *" htmlFor="p-loc" error={errors.location?.message}>
              <Input id="p-loc" {...register('location')} />
            </Field>
            <Field label="Bedrooms" htmlFor="p-bhk" error={errors.bedrooms?.message}>
              <Input id="p-bhk" inputMode="numeric" {...register('bedrooms')} />
            </Field>
            <Field label="Area (sq ft)" htmlFor="p-area" error={errors.areaSqft?.message}>
              <Input id="p-area" inputMode="numeric" {...register('areaSqft')} />
            </Field>
            <Field label="Price (₹) *" htmlFor="p-price" error={errors.price?.message}>
              <Input id="p-price" inputMode="numeric" placeholder="11200000" {...register('price')} />
            </Field>
            <Field label="Status *" htmlFor="p-status" error={errors.status?.message}>
              <Select id="p-status" {...register('status')}>
                {PROPERTY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s[0]}{s.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              {existing ? 'Save changes' : 'Add property'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PropertiesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Property | null>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<Property | null>(null);
  const q = useDebounce(search, 300);

  const list = useQuery({
    queryKey: ['properties', page, q, type, status],
    queryFn: () =>
      api<{ items: Property[]; total: number; page: number; pageSize: number }>(
        `/properties${qs({ page, q, propertyType: type || undefined, status: status || undefined, pageSize: 25 })}`,
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/properties/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Property removed');
      await qc.invalidateQueries({ queryKey: ['properties'] });
      setToDelete(null);
    },
    onError: (e) => handleApiError(e),
  });

  const editable = can('lead:write:all');

  return (
    <>
      <PageHeader
        title="Properties"
        description="Your available inventory. Match properties to buyers and share units in chat."
        actions={
          editable ? (
            <>
              <Button onClick={() => setImporting(true)}>
                <Upload className="h-4 w-4" aria-hidden />
                Import CSV
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add property
              </Button>
            </>
          ) : null
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search properties"
              placeholder="Search project, unit or location…"
              className="pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label="Filter status"
            className="w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {PROPERTY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]}{s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {list.isPending ? (
        <Skeleton className="h-64" />
      ) : list.data && list.data.items.length > 0 ? (
        <Card className="overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-xs text-left text-muted-foreground shadow-xs">
              <tr>
                <th className="px-4 py-2.5 font-medium">Property</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium text-right">Price</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                {editable ? <th className="px-4 py-2.5 font-medium" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.items.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{p.title}</p>
                    <p className="text-helper">
                      {p.bedrooms ? `${p.bedrooms} BHK · ` : ''}
                      {p.areaSqft ? `${p.areaSqft.toLocaleString('en-IN')} sq ft` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.location}</td>
                  <td className="px-4 py-2.5">{p.propertyType}</td>
                  <td className="num px-4 py-2.5 text-right font-medium">{formatINR(p.price)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={TONE[p.status]}>{p.status.toLowerCase()}</Badge>
                  </td>
                  {editable ? (
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Edit ${p.title}`}
                          onClick={() => {
                            setEditing(p);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${p.title}`}
                          onClick={() => setToDelete(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={list.data.page}
            total={list.data.total}
            pageSize={list.data.pageSize}
            onPage={setPage}
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={Building2}
            title="No properties yet"
            description="Add your units or upload a CSV to match properties with buyers."
            action={
              editable ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditing(null);
                    setOpen(true);
                  }}
                >
                  Add property
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      <PropertyDialog
        open={open}
        onOpenChange={setOpen}
        existing={editing}
      />
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        endpoint="/properties/import"
        title="Import properties"
        hint="Upload a CSV with project, unit, type, price, location, bedrooms and area."
        invalidate={[['properties']]}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        danger
        title={`Delete ${toDelete?.title ?? 'property'}?`}
        description="The unit is removed from your inventory and won't match future buyer requirements."
        confirmLabel="Delete property"
        onConfirm={async () => {
          if (toDelete) await remove.mutateAsync(toDelete.id);
        }}
      />
    </>
  );
}
