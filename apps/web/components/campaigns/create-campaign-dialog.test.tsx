import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateCampaignDialog } from './create-campaign-dialog';

vi.mock('@/lib/campaigns', () => ({
  useWhatsAppChannels: () => ({ data: [{ id: 'ch-1', name: 'Sales WhatsApp', externalId: '919876543210', status: 'ACTIVE' }] }),
  useWhatsAppTemplates: () => ({ data: [{ id: 'tpl-1', name: 'project_launch', language: 'en', category: 'MARKETING', bodyPreview: 'Hi {{1}}', variableCount: 1, approvalStatus: 'APPROVED' }] }),
  useAudiencePreview: () => ({ mutate: vi.fn(), data: { totalMatching: 10, eligibleCount: 8, optOutCount: 2 } }),
  useCreateCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/crm', () => ({
  useStages: () => ({ data: { stages: [{ id: 'st-1', name: 'Site Visit Scheduled' }], lostReasons: [] } }),
}));

describe('CreateCampaignDialog', () => {
  it('renders closed dialog as empty markup', () => {
    const qc = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <CreateCampaignDialog open={false} onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toBe('');
  });
});
