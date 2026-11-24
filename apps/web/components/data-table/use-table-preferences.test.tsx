import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ColumnDef } from './types';
import { useTablePreferences } from './use-table-preferences';

describe('useTablePreferences', () => {
  const columns: ColumnDef[] = [
    { id: 'name', label: 'Name', alwaysVisible: true },
    { id: 'email', label: 'Email' },
    { id: 'phone', label: 'Phone' },
  ];

  function TestTable({ onHook }: { onHook: (res: ReturnType<typeof useTablePreferences>) => void }) {
    const prefs = useTablePreferences('test-table', columns);
    onHook(prefs);
    return (
      <div>
        <span data-testid="visible">{prefs.visibleOrderedColumns.map((c) => c.id).join(',')}</span>
      </div>
    );
  }

  it('initializes visible columns in order', () => {
    let hookResult: ReturnType<typeof useTablePreferences> | null = null;
    const html = renderToStaticMarkup(<TestTable onHook={(h) => { hookResult = h; }} />);

    expect(html).toContain('name,email,phone');
    expect(hookResult).not.toBeNull();
    expect(hookResult!.orderedColumns.map((c) => c.id)).toEqual(['name', 'email', 'phone']);
    expect(hookResult!.isColumnVisible('name')).toBe(true);
    expect(hookResult!.isColumnVisible('email')).toBe(true);
    expect(hookResult!.isColumnPinned('name')).toBe(false);
  });
});
