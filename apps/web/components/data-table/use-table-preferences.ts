'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ColumnDef, RowDensity } from './types';

export function useTablePreferences(tableId: string, columns: ColumnDef[], defaultDensity: RowDensity = 'normal') {
  const colStorageKey = `lp:table:cols:${tableId}`;
  const densityStorageKey = `lp:table:density:${tableId}`;

  const getDefaultVisibleIds = useCallback(() => {
    return columns.filter((col) => col.defaultVisible !== false).map((col) => col.id);
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

  // Keep saved state updated in localStorage
  useEffect(() => {
    try {
      localStorage.setItem(colStorageKey, JSON.stringify(visibleColumnIds));
    } catch {
      // Ignore quota or disabled storage
    }
  }, [colStorageKey, visibleColumnIds]);

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

  const resetColumns = useCallback(() => {
    setVisibleColumnIds(getDefaultVisibleIds());
  }, [getDefaultVisibleIds]);

  const showAllColumns = useCallback(() => {
    setVisibleColumnIds(columns.map((c) => c.id));
  }, [columns]);

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
    isColumnVisible,
    toggleColumn,
    resetColumns,
    showAllColumns,
    density,
    setDensity,
    densityPadding,
    densityCellClass,
    densityHeaderClass,
  };
}
