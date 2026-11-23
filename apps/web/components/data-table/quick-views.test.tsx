import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuickViews, type QuickViewItem } from './quick-views';

describe('QuickViews', () => {
  const items: QuickViewItem[] = [
    { id: 'all', label: 'All Leads' },
    { id: 'my_leads', label: 'My Leads' },
    { id: 'overdue', label: 'Follow-up Overdue', count: 3, tone: 'danger' },
  ];

  it('renders all view tabs and active selection', () => {
    const html = renderToStaticMarkup(
      <QuickViews activeId="overdue" items={items} onSelect={() => {}} />
    );

    expect(html).toContain('All Leads');
    expect(html).toContain('My Leads');
    expect(html).toContain('Follow-up Overdue');
    expect(html).toContain('3');
    // activeId is overdue, aria-selected="true"
    expect(html).toContain('aria-selected="true"');
  });
});
