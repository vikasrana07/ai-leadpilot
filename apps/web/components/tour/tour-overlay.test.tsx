import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { computePopoverPosition, TourCard } from './tour-overlay';

describe('TourCard', () => {
  it('renders step progress, Skip on first step, and Next button', () => {
    const html = renderToStaticMarkup(
      <TourCard
        tourTitle="Dashboard"
        step={{ id: 's1', title: 'Welcome', description: 'Track your KPIs here.' }}
        stepIndex={0}
        totalSteps={3}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Dashboard');
    expect(html).toContain('Welcome');
    expect(html).toContain('Track your KPIs here.');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Step 1 of 3');
    expect(html).toContain('Skip');
    expect(html).toContain('Next');
    expect(html).not.toContain('Back');
  });

  it('renders Back and Done on the final step', () => {
    const html = renderToStaticMarkup(
      <TourCard
        tourTitle="Leads Directory"
        step={{ id: 's3', title: 'Bulk actions', description: 'Assign owners in bulk.' }}
        stepIndex={2}
        totalSteps={3}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Step 3 of 3');
    expect(html).toContain('Back');
    expect(html).toContain('Done');
    expect(html).not.toContain('Skip');
  });
});

describe('computePopoverPosition', () => {
  const viewport = { width: 1280, height: 800 };
  const popover = { width: 340, height: 190 };

  it('centers when targetRect is null or viewport is narrow', () => {
    const centered = computePopoverPosition(null, popover, viewport, 'bottom');
    expect(centered.centered).toBe(true);

    const mobile = computePopoverPosition({ top: 100, left: 40, width: 200, height: 40 }, popover, { width: 375, height: 812 }, 'bottom');
    expect(mobile.centered).toBe(true);
  });

  it('flips from bottom to top when target is near the bottom edge', () => {
    const pos = computePopoverPosition({ top: 700, left: 400, width: 200, height: 50 }, popover, viewport, 'bottom');
    expect(pos.centered).toBe(false);
    expect(pos.top).toBeLessThan(700);
  });
});
