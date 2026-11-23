import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RoleBuilderDialog } from './role-builder-dialog';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    ctx: {
      user: { id: 'u1', email: 'owner@example.com', name: 'Owner' },
      activeTenantId: 't1',
      membershipId: 'm1',
      roleKey: 'owner',
      permissions: ['role:manage', 'team:read'],
      workspaces: [],
    },
    can: () => true,
  }),
}));

describe('RoleBuilderDialog', () => {
  it('renders closed dialog as empty markup', () => {
    const qc = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <RoleBuilderDialog open={false} onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toBe('');
  });
});
