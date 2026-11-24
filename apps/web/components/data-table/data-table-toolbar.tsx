'use client';

import { Filter, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { AddFilterMenu } from './add-filter-menu';
import { ColumnVisibilityDropdown } from './column-visibility-dropdown';
import { FilterPill } from './filter-pill';
import { RowHeightDropdown } from './row-height-dropdown';
import type { ColumnDef, FilterDimension, RowDensity } from './types';

export interface DataTableToolbarProps {
  // Search
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  // Filter Dimensions
  dimensions?: FilterDimension[];
  activeFilters?: Record<string, string[]>;
  onFilterChange?: (dimensionId: string, values: string[]) => void;
  onClearAllFilters?: () => void;

  // Quick Boolean Toggles (e.g. "Follow-up overdue")
  booleanFilters?: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }[];

  // Column Visibility & Ordering
  columns?: ColumnDef[];
  orderedColumns?: ColumnDef[];
  isColumnVisible?: (id: string) => boolean;
  onToggleColumn?: (id: string) => void;
  onMoveColumn?: (id: string, direction: 'up' | 'down') => void;
  onReorderColumns?: (fromId: string, toId: string) => void;
  onTogglePinColumn?: (id: string) => void;
  isColumnPinned?: (id: string) => boolean;
  pinnedColumnIds?: string[];
  onResetColumns?: () => void;
  onShowAllColumns?: () => void;

  // Row Density
  density?: RowDensity;
  onDensityChange?: (density: RowDensity) => void;

  // Custom Slots
  leftActions?: ReactNode;
  rightActions?: ReactNode;
  className?: string;
}

export function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  dimensions = [],
  activeFilters = {},
  onFilterChange,
  onClearAllFilters,
  booleanFilters = [],
  columns,
  orderedColumns,
  isColumnVisible,
  onToggleColumn,
  onMoveColumn,
  onReorderColumns,
  onTogglePinColumn,
  isColumnPinned,
  pinnedColumnIds,
  onResetColumns,
  onShowAllColumns,
  density,
  onDensityChange,
  leftActions,
  rightActions,
  className,
}: DataTableToolbarProps) {
  // Calculate total active filter dimensions count
  const activeDimensionCount =
    Object.entries(activeFilters).filter(([_, vals]) => vals.length > 0).length +
    booleanFilters.filter((b) => b.checked).length;

  const hasActiveFilters = activeDimensionCount > 0 || (search && search.trim().length > 0);

  // Active dimension IDs
  const activeDimensionIds = Object.entries(activeFilters)
    .filter(([_, vals]) => vals.length > 0)
    .map(([id]) => id);

  return (
    <div className={cn('flex flex-col gap-2.5 border-b border-border p-3', className)}>
      {/* Primary Row: Search, View/Status & Table Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search box */}
          {onSearchChange !== undefined ? (
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <input
                type="text"
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-md border border-input/60 bg-card pl-8 pr-7 text-[13px] text-foreground placeholder:text-muted-foreground transition-colors hover:border-input focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={search ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Optional left actions */}
          {leftActions}

          {/* Active filter count badge (as in Screenshot 2) */}
          {activeDimensionCount > 0 ? (
            <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary-soft/50 px-2 text-[12px] font-medium text-primary dark:bg-primary-soft/10">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              <span>Filters</span>
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {activeDimensionCount}
              </span>
            </div>
          ) : null}
        </div>

        {/* Right side: Density, Columns & Custom Actions */}
        <div className="flex items-center gap-2">
          {density && onDensityChange ? (
            <RowHeightDropdown density={density} onDensityChange={onDensityChange} />
          ) : null}

          {columns && isColumnVisible && onToggleColumn && onResetColumns ? (
            <ColumnVisibilityDropdown
              columns={columns}
              orderedColumns={orderedColumns}
              isColumnVisible={isColumnVisible}
              onToggleColumn={onToggleColumn}
              onMoveColumn={onMoveColumn}
              onReorderColumns={onReorderColumns}
              onTogglePinColumn={onTogglePinColumn}
              isColumnPinned={isColumnPinned}
              pinnedColumnIds={pinnedColumnIds}
              onResetColumns={onResetColumns}
              onShowAllColumns={onShowAllColumns}
            />
          ) : null}

          {rightActions}
        </div>
      </div>

      {/* Secondary Row: Linear / Clockify Filter Pills Bar */}
      {(dimensions.length > 0 || booleanFilters.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="mr-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Filters:
          </span>

          {/* Filter Pills for Active Dimensions */}
          {dimensions.map((dim) => {
            const vals = activeFilters[dim.id] ?? [];
            return (
              <FilterPill
                key={dim.id}
                dimension={dim}
                selectedValues={vals}
                onChange={(newVals) => onFilterChange?.(dim.id, newVals)}
                onRemove={() => onFilterChange?.(dim.id, [])}
              />
            );
          })}

          {/* Active Boolean Filter Chips (only rendered when active/checked) */}
          {booleanFilters
            .filter((b) => b.checked)
            .map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => b.onChange(false)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/40 bg-primary-soft/60 px-2.5 text-[12px] font-medium text-primary-hover hover:bg-primary-soft/90 dark:bg-primary-soft/20 dark:text-primary-soft transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span>{b.label}</span>
                <X className="h-3 w-3 ml-0.5 opacity-70 hover:opacity-100" />
              </button>
            ))}

          {/* Add Filter Menu */}
          {(dimensions.length > 0 || booleanFilters.length > 0) && onFilterChange ? (
            <AddFilterMenu
              dimensions={dimensions}
              activeDimensionIds={activeDimensionIds}
              booleanFilters={booleanFilters}
              onSelectDimension={(dimId) => {
                const dim = dimensions.find((d) => d.id === dimId);
                if (dim && (!activeFilters[dimId] || activeFilters[dimId].length === 0)) {
                  const firstOpt = dim.options[0];
                  if (firstOpt) {
                    onFilterChange(dimId, [firstOpt.value]);
                  }
                }
              }}
            />
          ) : null}

          {/* Clear All Filters Action */}
          {hasActiveFilters && onClearAllFilters ? (
            <button
              type="button"
              onClick={onClearAllFilters}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-danger transition-colors"
            >
              <X className="h-3 w-3" />
              <span>Clear filters</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
