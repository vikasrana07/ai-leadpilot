import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTableToolbar } from './data-table-toolbar';
import type { ColumnDef, FilterDimension } from './types';

describe('DataTableToolbar', () => {
  const columns: ColumnDef[] = [
    { id: 'lead', label: 'Lead', alwaysVisible: true },
    { id: 'stage', label: 'Stage' },
    { id: 'temp', label: 'Temperature' },
  ];

  const dimensions: FilterDimension[] = [
    {
      id: 'stageId',
      label: 'Stage',
      options: [
        { value: 's1', label: 'New' },
        { value: 's2', label: 'Contacted' },
      ],
    },
    {
      id: 'temp',
      label: 'Temperature',
      options: [
        { value: 'HOT', label: 'Hot', dotColor: '#ef4444' },
      ],
    },
  ];

  it('renders search input and action buttons', () => {
    const html = renderToStaticMarkup(
      <DataTableToolbar
        search="Vikas"
        onSearchChange={() => {}}
        searchPlaceholder="Search leads…"
        columns={columns}
        isColumnVisible={(id) => id !== 'temp'}
        onToggleColumn={() => {}}
        onResetColumns={() => {}}
        onShowAllColumns={() => {}}
        density="normal"
        onDensityChange={() => {}}
      />
    );

    expect(html).toContain('placeholder="Search leads…"');
    expect(html).toContain('value="Vikas"');
    expect(html).toContain('Row height');
    expect(html).toContain('Columns');
    // Shows hidden count indicator for the hidden 'temp' column
    expect(html).toContain('-1');
  });

  it('renders active filter pills and counts', () => {
    const html = renderToStaticMarkup(
      <DataTableToolbar
        search=""
        onSearchChange={() => {}}
        dimensions={dimensions}
        activeFilters={{
          stageId: ['s1'],
          temp: ['HOT'],
        }}
        onFilterChange={() => {}}
        onClearAllFilters={() => {}}
        columns={columns}
        isColumnVisible={() => true}
        onToggleColumn={() => {}}
        onResetColumns={() => {}}
        onShowAllColumns={() => {}}
        density="compact"
        onDensityChange={() => {}}
      />
    );

    // Active filters badge
    expect(html).toContain('Filters');
    expect(html).toContain('2');
    // Pill labels
    expect(html).toContain('Stage');
    expect(html).toContain('New');
    expect(html).toContain('Temperature');
    expect(html).toContain('Hot');
    expect(html).toContain('Clear filters');
  });

  it('renders boolean filter chips only when active', () => {
    const htmlActive = renderToStaticMarkup(
      <DataTableToolbar
        booleanFilters={[
          {
            id: 'overdue',
            label: 'Follow-up overdue',
            checked: true,
            onChange: () => {},
          },
        ]}
      />
    );
    expect(htmlActive).toContain('Follow-up overdue');

    const htmlInactive = renderToStaticMarkup(
      <DataTableToolbar
        booleanFilters={[
          {
            id: 'overdue',
            label: 'Follow-up overdue',
            checked: false,
            onChange: () => {},
          },
        ]}
      />
    );
    expect(htmlInactive).not.toContain('Follow-up overdue');
  });
});
