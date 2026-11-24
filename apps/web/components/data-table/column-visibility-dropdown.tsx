'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns3,
  GripVertical,
  Pin,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import type { ColumnDef } from './types';

export interface ColumnVisibilityDropdownProps {
  columns: ColumnDef[];
  orderedColumns?: ColumnDef[];
  isColumnVisible: (id: string) => boolean;
  onToggleColumn: (id: string) => void;
  onMoveColumn?: (id: string, direction: 'up' | 'down') => void;
  onReorderColumns?: (fromId: string, toId: string) => void;
  onTogglePinColumn?: (id: string) => void;
  isColumnPinned?: (id: string) => boolean;
  pinnedColumnIds?: string[];
  onResetColumns: () => void;
  onShowAllColumns?: () => void;
}

export function ColumnVisibilityDropdown({
  columns,
  orderedColumns: propOrderedColumns,
  isColumnVisible,
  onToggleColumn,
  onMoveColumn,
  onReorderColumns,
  onTogglePinColumn,
  isColumnPinned,
  onResetColumns,
}: ColumnVisibilityDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [pointerDragId, setPointerDragId] = useState<string | null>(null);
  const reduce = useReducedMotion();

  // Use provided ordered columns or fallback to columns
  const effectiveColumns = propOrderedColumns ?? columns;

  // Filter out columns with empty labels (e.g. selection checkbox)
  const selectableColumns = useMemo(
    () => effectiveColumns.filter((c) => c.label.trim().length > 0),
    [effectiveColumns]
  );

  const shownColumns = useMemo(
    () => selectableColumns.filter((c) => isColumnVisible(c.id)),
    [selectableColumns, isColumnVisible]
  );

  const hiddenColumns = useMemo(
    () => selectableColumns.filter((c) => !isColumnVisible(c.id)),
    [selectableColumns, isColumnVisible]
  );

  const hiddenCount = hiddenColumns.length;

  const q = search.trim().toLowerCase();

  const filteredShownColumns = useMemo(
    () => (q ? shownColumns.filter((c) => c.label.toLowerCase().includes(q)) : shownColumns),
    [shownColumns, q]
  );

  const filteredHiddenColumns = useMemo(
    () => (q ? hiddenColumns.filter((c) => c.label.toLowerCase().includes(q)) : hiddenColumns),
    [hiddenColumns, q]
  );

  // Global pointerup listener for handle-drag reordering
  useEffect(() => {
    if (!pointerDragId) return;
    const handlePointerUp = () => {
      setPointerDragId(null);
    };
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, [pointerDragId]);

  // Pointer drag on handle
  const handleHandlePointerDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPointerDragId(id);
  };

  const handleRowPointerEnter = (targetId: string) => {
    if (pointerDragId && pointerDragId !== targetId && onReorderColumns) {
      onReorderColumns(pointerDragId, targetId);
    }
  };

  // HTML5 Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== id) {
      setDragOverId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = e.dataTransfer.getData('text/plain') || draggedId;
    if (sourceId && sourceId !== targetId && onReorderColumns) {
      onReorderColumns(sourceId, targetId);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const frozenCount = shownColumns.filter((c) => (isColumnPinned ? isColumnPinned(c.id) : !!c.pinned)).length;

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Customize visible columns"
        >
          <Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span>Columns</span>
          {hiddenCount > 0 ? (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold text-primary">
              -{hiddenCount}
            </span>
          ) : null}
        </button>
      </Menu.Trigger>
      <AnimatePresence>
        {open ? (
          <Menu.Portal forceMount>
            <Menu.Content
              asChild
              forceMount
              align="end"
              sideOffset={6}
              className="z-50 w-80 sm:w-84 rounded-xl border border-border bg-card shadow-xl outline-none"
            >
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
                onKeyDown={(e) => {
                  if (e.key === ' ') e.stopPropagation();
                }}
                className="flex flex-col"
              >
                {/* Search Input Bar */}
                <div className="p-3 pb-2">
                  <div className="relative flex items-center">
                    <Search
                      className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground/80"
                      aria-hidden
                    />
                    <input
                      type="text"
                      className="h-9 w-full rounded-lg border border-border/80 bg-background pl-9 pr-8 text-[13px] text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Find a field"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      autoFocus
                    />
                    {search ? (
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        aria-label="Clear field search"
                        className="absolute right-2.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Scrollable Column Lists Area */}
                <div className="max-h-80 overflow-y-auto px-1.5 py-1">
                  {/* Shown Section */}
                  {filteredShownColumns.length > 0 && (
                    <div className="mb-2">
                      <div className="px-2.5 pt-1.5 pb-1 text-[13px] font-medium text-muted-foreground select-none">
                        Shown · {filteredShownColumns.length}
                        {frozenCount > 0 ? ` · ${frozenCount} frozen` : ''}
                      </div>
                      <div className="space-y-0.5">
                        {filteredShownColumns.map((col, index) => {
                          const disabled = !!col.alwaysVisible;
                          const pinned = isColumnPinned ? isColumnPinned(col.id) : !!col.pinned;
                          const isFirst = index === 0;
                          const isLast = index === filteredShownColumns.length - 1;
                          const isDragging = draggedId === col.id || pointerDragId === col.id;
                          const isOver = dragOverId === col.id;

                          return (
                            <div
                              key={col.id}
                              draggable
                              onPointerDown={(e) => e.stopPropagation()}
                              onPointerEnter={() => handleRowPointerEnter(col.id)}
                              onDragStart={(e) => handleDragStart(e, col.id)}
                              onDragOver={(e) => handleDragOver(e, col.id)}
                              onDrop={(e) => handleDrop(e, col.id)}
                              onDragEnd={handleDragEnd}
                              className={cn(
                                'group flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] transition-colors',
                                'hover:bg-muted/60',
                                isDragging && 'opacity-50 ring-2 ring-primary/40 bg-primary/10 shadow-sm',
                                isOver && 'bg-primary/10 border-b-2 border-primary'
                              )}
                            >
                              {/* Left: Drag Handle, Checkbox, Column Label */}
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <span
                                  onPointerDown={(e) => handleHandlePointerDown(e, col.id)}
                                  className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground group-hover:text-muted-foreground p-0.5 rounded transition-colors touch-none select-none"
                                  title="Drag to reorder"
                                >
                                  <GripVertical className="h-4 w-4" aria-hidden />
                                </span>

                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => {
                                    if (!disabled) onToggleColumn(col.id);
                                  }}
                                  aria-label={`Hide ${col.label}`}
                                  className={cn(
                                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-primary text-primary-foreground transition-colors',
                                    disabled
                                      ? 'cursor-not-allowed opacity-60'
                                      : 'cursor-pointer hover:bg-primary-hover'
                                  )}
                                  title={disabled ? 'Fixed column' : `Hide ${col.label}`}
                                >
                                  <Check className="h-3 w-3 stroke-[3]" aria-hidden />
                                </button>

                                <span className="truncate font-medium text-foreground select-none">
                                  {col.label}
                                </span>
                              </div>

                              {/* Right: Up, Down, Pin Buttons */}
                              <div className="flex items-center gap-1 pl-2 select-none">
                                {/* Move Up Button */}
                                <button
                                  type="button"
                                  disabled={isFirst || !onMoveColumn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onMoveColumn?.(col.id, 'up');
                                  }}
                                  aria-label={`Move ${col.label} up`}
                                  title="Move up"
                                  className={cn(
                                    'rounded p-0.5 transition-colors',
                                    isFirst || !onMoveColumn
                                      ? 'cursor-not-allowed text-muted-foreground/30'
                                      : 'cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground'
                                  )}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                                </button>

                                {/* Move Down Button */}
                                <button
                                  type="button"
                                  disabled={isLast || !onMoveColumn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onMoveColumn?.(col.id, 'down');
                                  }}
                                  aria-label={`Move ${col.label} down`}
                                  title="Move down"
                                  className={cn(
                                    'rounded p-0.5 transition-colors',
                                    isLast || !onMoveColumn
                                      ? 'cursor-not-allowed text-muted-foreground/30'
                                      : 'cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground'
                                  )}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                                </button>

                                {/* Pin Button */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTogglePinColumn?.(col.id);
                                  }}
                                  aria-label={pinned ? `Unpin ${col.label}` : `Pin ${col.label} to freeze`}
                                  title={pinned ? 'Unpin column' : 'Pin to freeze'}
                                  className={cn(
                                    'rounded p-0.5 transition-colors',
                                    pinned
                                      ? 'text-primary fill-primary hover:text-primary-hover'
                                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                  )}
                                >
                                  <Pin
                                    className={cn('h-3.5 w-3.5', pinned && 'fill-primary')}
                                    aria-hidden
                                  />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* More Fields Section */}
                  {filteredHiddenColumns.length > 0 && (
                    <div className="mb-2">
                      <div className="px-2.5 pt-2 pb-1 text-[13px] font-medium text-muted-foreground select-none">
                        More fields
                      </div>
                      <div className="space-y-0.5">
                        {filteredHiddenColumns.map((col) => (
                          <div
                            key={col.id}
                            onClick={() => onToggleColumn(col.id)}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-muted/60 select-none"
                          >
                            <span className="w-4 shrink-0" aria-hidden />
                            <span
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-muted-foreground/40 bg-background transition-colors hover:border-foreground/70"
                              aria-hidden
                            />
                            <span className="truncate font-medium text-foreground">
                              {col.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state when searching */}
                  {filteredShownColumns.length === 0 && filteredHiddenColumns.length === 0 && (
                    <div className="py-6 text-center text-[13px] text-muted-foreground">
                      No fields found matching &ldquo;{search}&rdquo;
                    </div>
                  )}
                </div>

                {/* Footer: Drag tip on left, Reset to default on right */}
                <div className="flex items-center justify-between border-t border-border px-3.5 py-2.5 text-[12px] select-none">
                  <span className="text-muted-foreground">
                    Drag to reorder · pin to freeze
                  </span>
                  <button
                    type="button"
                    onClick={() => onResetColumns()}
                    className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline hover:text-primary-hover transition-colors"
                    title="Reset columns and order to default"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    <span>Reset to default</span>
                  </button>
                </div>
              </motion.div>
            </Menu.Content>
          </Menu.Portal>
        ) : null}
      </AnimatePresence>
    </Menu.Root>
  );
}
