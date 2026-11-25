import { describe, expect, it, vi } from 'vitest';
import { CannedResponsesService } from '../src/conversations/canned-responses.service.js';

describe('Canned Responses Service', () => {
  it('lists default system snippets when tenant has no custom settings', async () => {
    const mockTx = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ id: 'tenant-1', settings: {} }),
      },
    };
    const mockDb = {
      tenantTx: vi.fn(async (_ctx, fn) => fn(mockTx)),
    } as any;

    const service = new CannedResponsesService(mockDb);
    const list = await service.list({ tenantId: 'tenant-1' } as any);

    expect(list.length).toBeGreaterThanOrEqual(5);
    const shortcuts = list.map((x) => x.shortcut);
    expect(shortcuts).toContain('pricing');
    expect(shortcuts).toContain('brochure');
    expect(shortcuts).toContain('directions');
    expect(shortcuts).toContain('loan');
    expect(shortcuts).toContain('visit');
  });

  it('creates and saves custom canned response in tenant settings', async () => {
    const mockTx = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ id: 'tenant-1', settings: {} }),
        update: vi.fn().mockResolvedValue({ id: 'tenant-1' }),
      },
    };
    const mockDb = {
      tenantTx: vi.fn(async (_ctx, fn) => fn(mockTx)),
    } as any;

    const service = new CannedResponsesService(mockDb);
    const created = await service.create({ tenantId: 'tenant-1' } as any, {
      shortcut: '/parking',
      title: 'Covered Parking Policy',
      body: 'Every 2BHK and 3BHK comes with one covered stilt car parking space included.',
      category: 'Amenities',
    });

    expect(created.shortcut).toBe('parking');
    expect(created.title).toBe('Covered Parking Policy');
    expect(mockTx.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-1' },
        data: expect.objectContaining({
          settings: expect.objectContaining({
            cannedResponses: expect.arrayContaining([
              expect.objectContaining({ shortcut: 'parking' }),
            ]),
          }),
        }),
      }),
    );
  });
});
