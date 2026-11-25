'use client';

import type { LeadDto, PagedResult } from '@leadpilot/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowDown, ArrowUp, CalendarPlus, Download, Flame, FolderKanban, MessageSquare, Phone, Plus, Tag, Upload, User, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ImportDialog } from '@/components/crm/import-dialog';
import { LeadFormDialog } from '@/components/crm/lead-form-dialog';
import { WhatsappOptInDialog } from '@/components/crm/whatsapp-opt-in-dialog';
import { StageBadge, TemperatureBadge } from '@/components/crm/lead-badges';
import { DataTableToolbar, QuickViews, useTablePreferences, type ColumnDef, type FilterDimension, type QuickViewItem } from '@/components/data-table';
import { PageHeader } from '@/components/page/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { LeadsTableRowsSkeleton } from '@/components/skeletons';
import { useDebounce } from '@/hooks/use-debounce';
import { API_URL, api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { qs, useLeadMeta, useMembers, useStages } from '@/lib/crm';
import { formatBudget, timeAgo } from '@/lib/format';
import { usePack, useTerms } from '@/lib/pack';
import { t } from '@/lib/i18n';

type SortKey = 'createdAt' | 'name' | 'score' | 'nextFollowUpAt';
type BulkBody = { action: 'assign'; assignedMembershipId: string | null } | { action: 'stage'; stageId: string; lostReasonId?: string } | { action: 'tag'; add: string[]; remove: string[] } | { action: 'delete' };

export default function LeadsPage() {
  const { can } = useAuth();
  const lf = usePack().leadFields;
  const terms = useTerms();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const [f, setF] = useState<{
    stageId: string[];
    temperature: string[];
    assigned: string[];
    sourceId: string[];
    kind: string;
    overdue: string;
  }>({
    stageId: [],
    temperature: [],
    assigned: [],
    sourceId: [],
    kind: '',
    overdue: '',
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optInOpen, setOptInOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const stages = useStages();
  const meta = useLeadMeta();
  const members = useMembers();

  // Column definitions for Leads table
  const columns: ColumnDef[] = useMemo(
    () => [
      { id: 'lead', label: terms.Lead, alwaysVisible: true },
      { id: 'stage', label: 'Stage' },
      { id: 'temperature', label: 'Temp.' },
      ...(lf.budget
        ? [{ id: 'budget', label: lf.budget.label }]
        : lf.interest
        ? [{ id: 'interest', label: lf.interest.label }]
        : []),
      { id: 'assigned', label: 'Assigned' },
      { id: 'score', label: 'Score' },
      { id: 'followUp', label: 'Follow-up' },
      { id: 'createdAt', label: 'Added' },
      { id: 'actions', label: 'Actions', alwaysVisible: true },
    ],
    [terms.Lead, lf.budget, lf.interest]
  );

  const {
    isColumnVisible,
    toggleColumn,
    resetColumns,
    showAllColumns,
    density,
    setDensity,
    densityCellClass,
    densityHeaderClass,
    orderedColumns,
    visibleOrderedColumns,
    pinnedColumnIds,
    isColumnPinned,
    togglePinColumn,
    moveColumn,
    reorderColumns,
  } = useTablePreferences('leads', columns);

  const params = {
    q,
    stageId: f.stageId.join(',') || undefined,
    temperature: f.temperature.join(',') || undefined,
    assigned: f.assigned.join(',') || undefined,
    sourceId: f.sourceId.join(',') || undefined,
    kind: f.kind || undefined,
    overdue: f.overdue || undefined,
    sort: sort.key,
    dir: sort.dir,
  };
  const leads = useQuery({ queryKey: ['leads', 'list', params, page], queryFn: () => api<PagedResult<LeadDto>>(`/leads${qs({ ...params, page, pageSize: 25 })}`), placeholderData: (prev) => prev });
  const canReadAll = can('lead:read:all');
  const canWriteAll = can('lead:write:all');
  const items = leads.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const filtered =
    f.stageId.length > 0 ||
    f.temperature.length > 0 ||
    f.assigned.length > 0 ||
    f.sourceId.length > 0 ||
    Boolean(f.overdue) ||
    Boolean(f.kind) ||
    q !== '';

  const bulk = useMutation({
    mutationFn: (b: BulkBody) => api<{ updated: number; skipped: { id: string; reason: string }[] }>('/leads/bulk', { method: 'POST', body: { ...b, ids: [...selected] } }),
    onSuccess: (r) => {
      toast[r.skipped.length ? 'warning' : 'success'](`${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped: ${r.skipped[0]?.reason}` : ''}`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['leads'] }); void qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Bulk action failed'),
  });

  const changeLeadStage = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      api(`/leads/${id}/stage`, { method: 'POST', body: { stageId } }),
    onSuccess: () => {
      toast.success('Stage updated');
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Stage update failed'),
  });

  async function exportCsv() {
    const res = await fetch(`${API_URL}/leads/export${qs({ ...params })}`, { credentials: 'include' });
    if (!res.ok) { toast.error('Export failed'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // Filter dimensions definition (multi-select by default)
  const dimensions: FilterDimension[] = useMemo(
    () => [
      {
        id: 'stageId',
        label: 'Stage',
        icon: FolderKanban,
        mode: 'multi',
        options:
          stages.data?.stages.map((s) => ({
            value: s.id,
            label: s.name,
            dotColor: s.kind === 'WON' ? '#146c36' : s.kind === 'LOST' ? '#c62828' : '#3f55e8',
          })) ?? [],
      },
      {
        id: 'temperature',
        label: 'Temperature',
        icon: Flame,
        mode: 'multi',
        options: [
          { value: 'HOT', label: 'Hot', dotColor: '#ef4444' },
          { value: 'WARM', label: 'Warm', dotColor: '#f59e0b' },
          { value: 'COLD', label: 'Cold', dotColor: '#3b82f6' },
          { value: 'UNKNOWN', label: 'Unscored', dotColor: '#9ca3af' },
        ],
      },
      ...(canWriteAll
        ? [
            {
              id: 'assigned',
              label: 'Assigned to',
              icon: User,
              mode: 'multi' as const,
              options: [
                { value: 'me', label: 'Assigned to me' },
                { value: 'unassigned', label: 'Unassigned' },
                ...(members.data?.map((m) => ({ value: m.id, label: m.user.name })) ?? []),
              ],
            },
          ]
        : []),
      {
        id: 'sourceId',
        label: 'Source',
        icon: Tag,
        mode: 'multi',
        options: meta.data?.sources.map((s) => ({ value: s.id, label: s.name })) ?? [],
      },
    ],
    [stages.data?.stages, canWriteAll, members.data, meta.data?.sources]
  );

  const activeFilters = useMemo(
    () => ({
      stageId: f.stageId,
      temperature: f.temperature,
      assigned: f.assigned,
      sourceId: f.sourceId,
    }),
    [f.stageId, f.temperature, f.assigned, f.sourceId]
  );

  const handleFilterChange = (dimId: string, values: string[]) => {
    setF((s) => ({ ...s, [dimId]: values }));
    setPage(1);
  };

  const handleClearAllFilters = () => {
    setSearch('');
    setF({ stageId: [], temperature: [], assigned: [], sourceId: [], kind: '', overdue: '' });
    setPage(1);
  };

  const quickViews: QuickViewItem[] = useMemo(
    () => [
      ...(canReadAll ? [{ id: 'all', label: `All ${terms.Leads}`, icon: Users }] : []),
      { id: 'my_leads', label: 'My Leads', icon: User, tone: 'primary' },
      { id: 'overdue', label: 'Follow-up Overdue', icon: AlertCircle, tone: 'danger' },
      { id: 'hot', label: 'Hot Leads', icon: Flame, tone: 'warning' },
    ],
    [canReadAll, terms.Leads]
  );

  const activeQuickViewId = useMemo(() => {
    if (f.overdue === 'true' && f.stageId.length === 0 && f.temperature.length === 0 && f.assigned.length === 0 && f.sourceId.length === 0 && !search) {
      return 'overdue';
    }
    if (f.assigned.length === 1 && f.assigned[0] === 'me' && f.stageId.length === 0 && f.temperature.length === 0 && f.sourceId.length === 0 && !f.overdue && !search) {
      return 'my_leads';
    }
    if (f.temperature.length === 1 && f.temperature[0] === 'HOT' && f.stageId.length === 0 && f.assigned.length === 0 && f.sourceId.length === 0 && !f.overdue && !search) {
      return 'hot';
    }
    if (f.stageId.length === 0 && f.temperature.length === 0 && f.assigned.length === 0 && f.sourceId.length === 0 && !f.overdue && !f.kind && !search) {
      return canReadAll ? 'all' : 'my_leads';
    }
    return '';
  }, [canReadAll, f, search]);

  const handleSelectQuickView = (id: string) => {
    if (id === 'all' || (id === 'my_leads' && !canReadAll)) {
      handleClearAllFilters();
    } else if (id === 'my_leads') {
      setSearch('');
      setF({ stageId: [], temperature: [], assigned: ['me'], sourceId: [], kind: '', overdue: '' });
      setPage(1);
    } else if (id === 'overdue') {
      setSearch('');
      setF({ stageId: [], temperature: [], assigned: [], sourceId: [], kind: '', overdue: 'true' });
      setPage(1);
    } else if (id === 'hot') {
      setSearch('');
      setF({ stageId: [], temperature: ['HOT'], assigned: [], sourceId: [], kind: '', overdue: '' });
      setPage(1);
    }
  };

  // Column fixed widths in pixels for precise sticky freeze alignment
  const COLUMN_WIDTHS: Record<string, number> = {
    lead: 260,
    temperature: 110,
    stage: 160,
    budget: 130,
    interest: 140,
    assigned: 150,
    score: 90,
    followUp: 120,
    createdAt: 110,
    actions: 110,
  };

  const getColWidth = (colId: string) => COLUMN_WIDTHS[colId] ?? 130;

  const totalTableWidth = useMemo(
    () => 40 + visibleOrderedColumns.reduce((sum, col) => sum + getColWidth(col.id), 0),
    [visibleOrderedColumns]
  );

  const frozenOffsetMap = useMemo(() => {
    const map = new Map<string, number>();
    let offset = 40; // width of row checkbox column (w-10 = 40px)
    for (const col of visibleOrderedColumns) {
      if (isColumnPinned(col.id)) {
        map.set(col.id, offset);
        offset += getColWidth(col.id);
      }
    }
    return map;
  }, [visibleOrderedColumns, isColumnPinned]);

  const lastPinnedColId = useMemo(() => {
    const pinned = visibleOrderedColumns.filter((c) => isColumnPinned(c.id));
    return pinned.length > 0 ? pinned[pinned.length - 1]?.id : null;
  }, [visibleOrderedColumns, isColumnPinned]);

  const th = (label: string, key?: SortKey, cls = '', colId?: string) => {
    const isPinned = colId ? isColumnPinned(colId) : false;
    const isLastPinned = colId ? colId === lastPinnedColId : false;
    const offset = colId ? frozenOffsetMap.get(colId) : undefined;
    const width = colId ? getColWidth(colId) : undefined;
    const isActionsCol = colId === 'actions';
    const style: React.CSSProperties = {
      ...(isPinned && width
        ? { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }
        : isActionsCol && width
        ? { width: `${width}px`, minWidth: `${width}px` }
        : width
        ? { minWidth: `${width}px` }
        : {}),
      ...(isPinned && offset !== undefined ? { left: `${offset}px` } : {}),
    };

    return (
      <th
        key={colId ?? label}
        scope="col"
        style={style}
        className={cn(
          'font-medium truncate',
          densityHeaderClass,
          cls,
          isPinned &&
            cn(
              'sticky z-20 bg-surface/95',
              isLastPinned
                ? 'border-r-2 border-border shadow-[3px_0_6px_-2px_rgba(0,0,0,0.12)]'
                : 'border-r border-border/20'
            )
        )}
        aria-sort={key && sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        {key ? (
          <button
            className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
          >
            {label}
            {sort.key === key ? (
              sort.dir === 'asc' ? (
                <ArrowUp className="h-3 w-3" aria-hidden />
              ) : (
                <ArrowDown className="h-3 w-3" aria-hidden />
              )
            ) : null}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  const renderHeaderCell = (colId: string) => {
    switch (colId) {
      case 'lead':
        return th(terms.Lead, 'name', '', 'lead');
      case 'stage':
        return th('Stage', undefined, '', 'stage');
      case 'temperature':
        return th('Temp.', undefined, '', 'temperature');
      case 'budget':
        return lf.budget ? th(lf.budget.label, undefined, '', 'budget') : null;
      case 'interest':
        return !lf.budget && lf.interest ? th(lf.interest.label, undefined, '', 'interest') : null;
      case 'assigned':
        return th('Assigned', undefined, '', 'assigned');
      case 'score':
        return th('Score', 'score', 'text-right', 'score');
      case 'followUp':
        return th('Follow-up', 'nextFollowUpAt', '', 'followUp');
      case 'createdAt':
        return th('Added', 'createdAt', '', 'createdAt');
      case 'actions': {
        const isPinned = isColumnPinned('actions');
        const isLastPinned = 'actions' === lastPinnedColId;
        const offset = frozenOffsetMap.get('actions');
        const width = getColWidth('actions');
        const style: React.CSSProperties = {
          width: `${width}px`,
          minWidth: `${width}px`,
          maxWidth: isPinned ? `${width}px` : undefined,
          ...(isPinned && offset !== undefined ? { left: `${offset}px` } : {}),
        };
        return (
          <th
            key="actions"
            scope="col"
            style={style}
            className={cn(
              'text-right pr-4 font-medium truncate',
              densityHeaderClass,
              isPinned &&
                cn(
                  'sticky z-20 bg-surface/95',
                  isLastPinned
                    ? 'border-r-2 border-border shadow-[3px_0_6px_-2px_rgba(0,0,0,0.12)]'
                    : 'border-r border-border/20'
                )
            )}
          >
            Actions
          </th>
        );
      }
      default:
        return null;
    }
  };

  const renderRowCell = (colId: string, l: LeadDto) => {
    const isPinned = isColumnPinned(colId);
    const isLastPinned = colId === lastPinnedColId;
    const offset = frozenOffsetMap.get(colId);
    const width = getColWidth(colId);
    const isActionsCol = colId === 'actions';
    const style: React.CSSProperties = {
      ...(isPinned && width
        ? { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }
        : isActionsCol && width
        ? { width: `${width}px`, minWidth: `${width}px` }
        : width
        ? { minWidth: `${width}px` }
        : {}),
      ...(isPinned && offset !== undefined ? { left: `${offset}px` } : {}),
    };
    const pinnedClass = isPinned
      ? cn(
          'sticky z-10 bg-surface',
          isLastPinned
            ? 'border-r-2 border-border shadow-[3px_0_6px_-2px_rgba(0,0,0,0.12)]'
            : 'border-r border-border/20'
        )
      : '';

    switch (colId) {
      case 'lead':
        return (
          <td key="lead" style={style} className={cn(densityCellClass, pinnedClass)}>
            <Link href={`/leads/${l.id}`} className="block truncate">
              <span className="font-medium hover:text-primary truncate block">{l.name}</span>
              <span className="text-helper block truncate">
                {l.phone ?? l.email}
                {l.location ? ` · ${l.location}` : ''}
              </span>
            </Link>
          </td>
        );
      case 'stage':
        return (
          <td key="stage" style={style} className={cn(densityCellClass, pinnedClass)}>
            <div className="flex items-center gap-1.5 min-w-0">
              <StageBadge name={l.stage.name} kind={l.stage.kind} />
              {(can('lead:write:all') || can('lead:write:own')) && stages.data?.stages ? (
                <select
                  aria-label={`Change stage for ${l.name}`}
                  value={l.stage.id}
                  onChange={(e) => {
                    const nextStageId = e.target.value;
                    if (nextStageId && nextStageId !== l.stage.id) {
                      changeLeadStage.mutate({ id: l.id, stageId: nextStageId });
                    }
                  }}
                  className="h-6 rounded border border-border bg-surface px-1 text-[11px] text-muted-foreground cursor-pointer truncate max-w-[90px]"
                  title="Quick change stage"
                >
                  {stages.data.stages.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </td>
        );
      case 'temperature':
        return (
          <td key="temperature" style={style} className={cn(densityCellClass, pinnedClass)}>
            <TemperatureBadge value={l.temperature} />
          </td>
        );
      case 'budget':
        return lf.budget ? (
          <td key="budget" style={style} className={cn('num whitespace-nowrap truncate', densityCellClass, pinnedClass)}>
            {formatBudget(l.budgetMin, l.budgetMax)}
          </td>
        ) : null;
      case 'interest':
        return !lf.budget && lf.interest ? (
          <td key="interest" style={style} className={cn('whitespace-nowrap truncate', densityCellClass, pinnedClass)}>
            <span className="text-[13px] text-foreground truncate block">{l.propertyType || '—'}</span>
          </td>
        ) : null;
      case 'assigned':
        return (
          <td key="assigned" style={style} className={cn(densityCellClass, pinnedClass)}>
            {l.assignee ? (
              <span className="flex items-center gap-2 truncate">
                <Avatar name={l.assignee.name} size={density === 'compact' ? 18 : 22} />
                <span className="truncate">{l.assignee.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground truncate">Unassigned</span>
            )}
          </td>
        );
      case 'score':
        return (
          <td key="score" style={style} className={cn('num text-right truncate', densityCellClass, pinnedClass)}>
            {l.score ?? <span className="text-muted-foreground">—</span>}
          </td>
        );
      case 'followUp': {
        const overdue =
          l.nextFollowUpAt !== null &&
          new Date(l.nextFollowUpAt) < new Date() &&
          l.stage.kind === 'OPEN';
        return (
          <td
            key="followUp"
            style={style}
            className={cn('num whitespace-nowrap truncate', densityCellClass, overdue && 'font-medium text-danger', pinnedClass)}
          >
            {l.nextFollowUpAt ? timeAgo(l.nextFollowUpAt) : <span className="text-muted-foreground">—</span>}
          </td>
        );
      }
      case 'createdAt':
        return (
          <td key="createdAt" style={style} className={cn('num whitespace-nowrap text-muted-foreground truncate', densityCellClass, pinnedClass)}>
            {timeAgo(l.createdAt)}
          </td>
        );
      case 'actions':
        return (
          <td key="actions" style={style} className={cn('whitespace-nowrap text-right pr-4', densityCellClass, pinnedClass)}>
            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {l.phone ? (
                <a
                  href={`https://wa.me/${l.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                    `Hi ${l.name}, reaching out regarding your enquiry.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Chat with ${l.name} on WhatsApp`}
                  title="Chat on WhatsApp"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
              {l.phone ? (
                <a
                  href={`tel:${l.phone}`}
                  aria-label={`Call ${l.name}`}
                  title={`Call ${l.phone}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
              <Link
                href={`/appointments?bookLeadId=${l.id}&bookLeadName=${encodeURIComponent(l.name)}`}
                aria-label={`Book appointment for ${l.name}`}
                title="Book appointment"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        title={terms.Leads}
        description="Every enquiry, scored and assigned."
        actions={
          <div data-tour="leads-actions" className="flex flex-wrap items-center gap-2">
            {can('lead:import') ? (
              <Button onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden />
                {t('leads.import')}
              </Button>
            ) : null}
            {can('lead:export') ? (
              <Button onClick={() => void exportCsv()}>
                <Download className="h-4 w-4" aria-hidden />
                {t('leads.export')}
              </Button>
            ) : null}
            {can('lead:write:all') || can('lead:write:own') ? (
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />Add {terms.lead}
              </Button>
            ) : null}
          </div>
        }
      />

      <Card data-tour="leads-table" className="overflow-hidden">
        {/* Quick View Presets */}
        <div data-tour="leads-quick-views">
          <QuickViews
            activeId={activeQuickViewId}
            items={quickViews}
            onSelect={handleSelectQuickView}
          />
        </div>

        {/* Dynamic Data Table Toolbar */}
        <div data-tour="leads-toolbar">
          <DataTableToolbar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          searchPlaceholder={`Search ${terms.leads} by name, phone, email…`}
          dimensions={dimensions}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearAllFilters={handleClearAllFilters}
          booleanFilters={[
            {
              id: 'overdue',
              label: 'Follow-up overdue',
              checked: f.overdue === 'true',
              onChange: (checked) => {
                setF((s) => ({ ...s, overdue: checked ? 'true' : '' }));
                setPage(1);
              },
            },
          ]}
          columns={columns}
          orderedColumns={orderedColumns}
          isColumnVisible={isColumnVisible}
          onToggleColumn={toggleColumn}
          onMoveColumn={moveColumn}
          onReorderColumns={reorderColumns}
          onTogglePinColumn={togglePinColumn}
          isColumnPinned={isColumnPinned}
          pinnedColumnIds={pinnedColumnIds}
          onResetColumns={resetColumns}
          onShowAllColumns={showAllColumns}
          density={density}
          onDensityChange={setDensity}
        />
        </div>

        {/* Bulk Selection Actions Bar */}
        {selected.size > 0 ? (
          <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft px-3 py-2 text-[13px]">
            <span className="num font-medium">{selected.size} selected</span>
            {can('lead:assign') ? (
              <Select
                aria-label="Assign selected to"
                className="w-auto"
                value=""
                onChange={(e) => {
                  if (e.target.value) bulk.mutate({ action: 'assign', assignedMembershipId: e.target.value === 'none' ? null : e.target.value });
                }}
              >
                <option value="">Assign to…</option>
                <option value="none">Unassigned</option>
                {members.data?.filter((m) => m.status === 'ACTIVE').map((m) => (
                  <option key={m.id} value={m.id}>{m.user.name}</option>
                ))}
              </Select>
            ) : null}
            <Select
              aria-label="Move selected to stage"
              className="w-auto"
              value=""
              onChange={(e) => {
                const s = stages.data?.stages.find((x) => x.id === e.target.value);
                if (s && s.kind !== 'LOST') bulk.mutate({ action: 'stage', stageId: s.id });
                else if (s) toast.info('Open each lead to record why it was lost');
              }}
            >
              <option value="">Move to stage…</option>
              {stages.data?.stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            {can('campaign:manage') && can('lead:write:all') ? (
              <Button size="sm" onClick={() => setOptInOpen(true)}>
                Record WhatsApp opt-in
              </Button>
            ) : null}
            {can('lead:delete') ? (
              <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        ) : null}

        {/* Table Content */}
        {leads.isPending ? (
          <LeadsTableRowsSkeleton count={8} />
        ) : leads.isError ? (
          <EmptyState
            icon={Users}
            title={`Could not load ${terms.leads}`}
            description="Check your connection and try again."
            action={<Button onClick={() => void leads.refetch()}>Retry</Button>}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              filtered
                ? `No ${terms.leads} match these filters`
                : canReadAll
                  ? `No ${terms.leads} yet`
                  : `No ${terms.leads} assigned to you yet`
            }
            description={
              filtered
                ? 'Try clearing a filter or searching for something else.'
                : canReadAll
                  ? `Add your first ${terms.lead}, import a CSV, or connect a lead source.`
                  : `Ask your manager to assign ${terms.leads} to you, enable round-robin distribution, or add a new ${terms.lead}.`
            }
            action={
              !filtered && (can('lead:write:all') || can('lead:write:own')) ? (
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden />Add {terms.lead}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={cn(leads.isPlaceholderData && 'opacity-60 transition-opacity')}>
            {/* Mobile View */}
            <ul className="divide-y divide-border md:hidden" aria-label={terms.Leads}>
              {items.map((l) => (
                <li key={l.id}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Select ${l.name}`}
                      checked={selected.has(l.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(l.id);
                          else n.delete(l.id);
                          return n;
                        })
                      }
                    />
                    <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[14px] font-medium">{l.name}</span>
                        <TemperatureBadge value={l.temperature} />
                      </span>
                      <span className="text-helper block truncate">
                        {l.phone ?? l.email}
                        {l.location ? ` · ${l.location}` : ''}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <StageBadge name={l.stage.name} kind={l.stage.kind} />
                        {lf.budget ? (
                          <span className="num text-[12px] text-muted-foreground">
                            {formatBudget(l.budgetMin, l.budgetMax)}
                          </span>
                        ) : lf.interest && l.propertyType ? (
                          <span className="text-[12px] text-muted-foreground">
                            {l.propertyType}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-helper mt-1.5 block">
                        {l.assignee ? l.assignee.name : 'Unassigned'} · added {timeAgo(l.createdAt)}
                        {l.nextFollowUpAt && l.stage.kind === 'OPEN'
                          ? ` · follow-up ${timeAgo(l.nextFollowUpAt)}`
                          : ''}
                      </span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop Table View */}
            <div className="hidden overflow-x-auto md:block">
              <table
                className="w-full text-left table-fixed"
                style={{ minWidth: `${totalTableWidth}px` }}
              >
                <colgroup>
                  <col style={{ width: '40px' }} />
                  {visibleOrderedColumns.map((col) => {
                    const isPinned = isColumnPinned(col.id);
                    const isActionsCol = col.id === 'actions';
                    return isPinned || isActionsCol ? (
                      <col key={col.id} style={{ width: `${getColWidth(col.id)}px` }} />
                    ) : (
                      <col key={col.id} />
                    );
                  })}
                </colgroup>
                <thead className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-xs text-label text-muted-foreground shadow-xs">
                  <tr>
                    <th
                      scope="col"
                      style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}
                      className={cn(
                        'sticky left-0 z-20 bg-surface/95 w-10 px-3',
                        densityHeaderClass,
                        !lastPinnedColId ? 'border-r border-border/40' : 'border-r border-border/20'
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allOnPage}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            items.forEach((l) => (e.target.checked ? n.add(l.id) : n.delete(l.id)));
                            return n;
                          })
                        }
                      />
                    </th>
                    {visibleOrderedColumns.map((col) => renderHeaderCell(col.id))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((l) => (
                    <tr
                      key={l.id}
                      className={cn('hover:bg-muted/40 transition-colors', selected.has(l.id) && 'bg-primary-soft/50')}
                    >
                      <td
                        style={{ width: '40px', minWidth: '40px', maxWidth: '40px' }}
                        className={cn(
                          'sticky left-0 z-10 bg-surface w-10 px-3',
                          densityCellClass,
                          !lastPinnedColId ? 'border-r border-border/40' : 'border-r border-border/20'
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.name}`}
                          checked={selected.has(l.id)}
                          onChange={(e) =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(l.id);
                              else n.delete(l.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      {visibleOrderedColumns.map((col) => renderRowCell(col.id, l))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {leads.data && leads.data.total > 0 ? (
          <Pagination page={page} pageSize={25} total={leads.data.total} onPage={setPage} />
        ) : null}
      </Card>

      <LeadFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        endpoint="/leads/import"
        title={`Import ${terms.leads}`}
        hint={
          lf.budget
            ? 'CSV with a header row. Columns: name, phone, email, budget, location, source, tags… Amounts like 85 L or 1.2 Cr work.'
            : 'CSV with a header row. Columns: name, phone, email, location, source, tags…'
        }
        invalidate={[['leads'], ['pipeline'], ['analytics']]}
      />
      <WhatsappOptInDialog open={optInOpen} onOpenChange={setOptInOpen} leadIds={[...selected]} onDone={() => setSelected(new Set())} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        danger
        title={`Delete ${selected.size} ${selected.size === 1 ? terms.lead : terms.leads}?`}
        description="They disappear from lists and reports. This is recorded in the audit log."
        confirmLabel="Delete"
        onConfirm={async () => {
          await bulk.mutateAsync({ action: 'delete' });
        }}
      />
    </>
  );
}
