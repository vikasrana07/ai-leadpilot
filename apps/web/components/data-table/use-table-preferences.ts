'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef, RowDensity } from './types';

export function useTablePreferences(tableId: string, columns: ColumnDef[], defaultDensity: RowDensity = 'normal') {
  const colStorageKey = `lp:table:cols:${tableId}`;
  const orderStorageKey = `lp:table:order:${tableId}`;
  const pinnedStorageKey = `lp:table:pinned:${tableId}`;
  const densityStorageKey = `lp:table:density:${tableId}`;

  const allColIds = useMemo(() => columns.map((col) => col.id), [columns]);

  const getDefaultVisibleIds = useCallback(() => {
    return columns.filter((col) => col.defaultVisible !== false).map((col) => col.id);
  }, [columns]);

  const getDefaultPinnedIds = useCallback(() => {
    return columns.filter((col) => Boolean(col.pinned)).map((col) => col.id);
  }, [columns]);

  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return getDefaultVisibleIds();
    try {
      const saved = localStorage.getItem(colStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback
    }
    return getDefaultVisibleIds();
  });

  const [columnOrder, setColumnOrderState] = useState<string[]>(() => {
    if (typeof window === 'undefined') return columns.map((c) => c.id);
    try {
      const saved = localStorage.getItem(orderStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter((id) => allColIds.includes(id));
          const missing = allColIds.filter((id) => !valid.includes(id));
          return [...valid, ...missing];
        }
      }
    } catch {
      // Fallback
    }
    return columns.map((c) => c.id);
  });

  const [pinnedColumnIds, setPinnedColumnIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return getDefaultPinnedIds();
    try {
      const saved = localStorage.getItem(pinnedStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Fallback
    }
    return getDefaultPinnedIds();
  });

  const [density, setDensityState] = useState<RowDensity>(() => {
    if (typeof window === 'undefined') return defaultDensity;
    try {
      const saved = localStorage.getItem(densityStorageKey);
      if (saved === 'compact' || saved === 'normal' || saved === 'relaxed') {
        return saved;
      }
    } catch {
      // Fallback
    }
    return defaultDensity;
  });

  // Sync column order if columns change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reconciles column order when column definitions change
    setColumnOrderState((prev) => {
      const valid = prev.filter((id) => allColIds.includes(id));
      const missing = allColIds.filter((id) => !valid.includes(id));
      if (missing.length === 0 && valid.length === prev.length) return prev;
      return [...valid, ...missing];
    });
  }, [allColIds]);

  // Keep saved state updated in localStorage
  useEffect(() => {
    try {
      localStorage.setItem(colStorageKey, JSON.stringify(visibleColumnIds));
    } catch {
      // Ignore quota or disabled storage
    }
  }, [colStorageKey, visibleColumnIds]);

  useEffect(() => {
    try {
      localStorage.setItem(orderStorageKey, JSON.stringify(columnOrder));
    } catch {
      // Ignore
    }
  }, [orderStorageKey, columnOrder]);

  useEffect(() => {
    try {
      localStorage.setItem(pinnedStorageKey, JSON.stringify(pinnedColumnIds));
    } catch {
      // Ignore
    }
  }, [pinnedStorageKey, pinnedColumnIds]);

  const setDensity = useCallback(
    (newDensity: RowDensity) => {
      setDensityState(newDensity);
      try {
        localStorage.setItem(densityStorageKey, newDensity);
      } catch {
        // Ignore
      }
    },
    [densityStorageKey]
  );

  const isColumnVisible = useCallback(
    (id: string) => {
      const col = columns.find((c) => c.id === id);
      if (col?.alwaysVisible) return true;
      return visibleColumnIds.includes(id);
    },
    [columns, visibleColumnIds]
  );

  const isColumnPinned = useCallback(
    (id: string) => {
      return pinnedColumnIds.includes(id);
    },
    [pinnedColumnIds]
  );

  const toggleColumn = useCallback(
    (id: string) => {
      const col = columns.find((c) => c.id === id);
      if (col?.alwaysVisible) return; // Cannot toggle alwaysVisible

      setVisibleColumnIds((prev) => {
        if (prev.includes(id)) {
          // Do not allow hiding if it's the last remaining column
          if (prev.length <= 1) return prev;
          return prev.filter((c) => c !== id);
        } else {
          return [...prev, id];
        }
      });
    },
    [columns]
  );

  const togglePinColumn = useCallback((id: string) => {
    setPinnedColumnIds((prev) => {
      const isCurrentlyPinned = prev.includes(id);
      if (isCurrentlyPinned) {
        return prev.filter((c) => c !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);

  const moveColumn = useCallback(
    (id: string, direction: 'up' | 'down') => {
      setColumnOrderState((prev) => {
        const isPinned = pinnedColumnIds.includes(id);

        // Group shown columns: pinned stay together, unpinned stay together
        const relevantGroup = prev.filter((cId) => {
          const col = columns.find((c) => c.id === cId);
          const isVis = col?.alwaysVisible || visibleColumnIds.includes(cId);
          if (!isVis) return false;
          return isPinned ? pinnedColumnIds.includes(cId) : !pinnedColumnIds.includes(cId);
        });

        const currentIndex = relevantGroup.indexOf(id);
        if (currentIndex === -1) return prev;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= relevantGroup.length) return prev;

        const targetId = relevantGroup[targetIndex];
        if (!targetId) return prev;

        const nextOrder = [...prev];
        const fromPos = nextOrder.indexOf(id);
        const toPos = nextOrder.indexOf(targetId);

        if (fromPos === -1 || toPos === -1) return prev;

        nextOrder.splice(fromPos, 1);
        nextOrder.splice(toPos, 0, id);
        return nextOrder;
      });
    },
    [columns, visibleColumnIds, pinnedColumnIds]
  );

  const reorderColumns = useCallback((fromId: string, toId: string) => {
    setColumnOrderState((prev) => {
      const fromPos = prev.indexOf(fromId);
      const toPos = prev.indexOf(toId);
      if (fromPos === -1 || toPos === -1 || fromPos === toPos) return prev;
      const nextOrder = [...prev];
      nextOrder.splice(fromPos, 1);
      nextOrder.splice(toPos, 0, fromId);
      return nextOrder;
    });
  }, []);

  const setColumnOrder = useCallback((newOrder: string[]) => {
    setColumnOrderState(newOrder);
  }, []);

  const resetColumns = useCallback(() => {
    setVisibleColumnIds(getDefaultVisibleIds());
    setColumnOrderState(columns.map((c) => c.id));
    setPinnedColumnIds(getDefaultPinnedIds());
  }, [columns, getDefaultPinnedIds, getDefaultVisibleIds]);

  const showAllColumns = useCallback(() => {
    setVisibleColumnIds(columns.map((c) => c.id));
  }, [columns]);

  // Construct full ordered ColumnDef array with pinned columns first
  const orderedColumns = useMemo(() => {
    const map = new Map(columns.map((c) => [c.id, c]));
    const ordered: ColumnDef[] = [];
    columnOrder.forEach((id) => {
      const col = map.get(id);
      if (col) {
        ordered.push(col);
        map.delete(id);
      }
    });
    // Add any remaining columns
    map.forEach((col) => ordered.push(col));

    // Sort so pinned columns are at the front, preserving relative order in each group
    const pinned = ordered.filter((c) => pinnedColumnIds.includes(c.id));
    const unpinned = ordered.filter((c) => !pinnedColumnIds.includes(c.id));
    return [...pinned, ...unpinned];
  }, [columnOrder, columns, pinnedColumnIds]);

  // Visible columns in user-defined order (pinned columns first)
  const visibleOrderedColumns = useMemo(() => {
    return orderedColumns.filter((col) => col.alwaysVisible || visibleColumnIds.includes(col.id));
  }, [orderedColumns, visibleColumnIds]);

  const densityPadding =
    density === 'compact' ? 'py-1.5' : density === 'relaxed' ? 'py-3.5' : 'py-2.5';

  const densityCellClass =
    density === 'compact'
      ? 'px-3 py-1.5 text-[12px]'
      : density === 'relaxed'
        ? 'px-4 py-3.5 text-[14px]'
        : 'px-3 py-2 text-[13px]';

  const densityHeaderClass =
    density === 'compact'
      ? 'px-3 py-1.5 text-[11px]'
      : density === 'relaxed'
        ? 'px-4 py-3 text-[13px]'
        : 'px-3 py-2.5 text-[12px]';

  return {
    visibleColumnIds,
    columnOrder,
    orderedColumns,
    visibleOrderedColumns,
    pinnedColumnIds,
    isColumnVisible,
    isColumnPinned,
    toggleColumn,
    togglePinColumn,
    moveColumn,
    reorderColumns,
    setColumnOrder,
    resetColumns,
    showAllColumns,
    density,
    setDensity,
    densityPadding,
    densityCellClass,
    densityHeaderClass,
  };
}
