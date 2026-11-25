import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from '../src/integrations/google-calendar/google-calendar.service.js';
import { GoogleCalendarWebhookController } from '../src/integrations/google-calendar/google-calendar-webhook.controller.js';

describe('Google Calendar Webhook & Reconciliation', () => {
  it('handles sync handshake', async () => {
    const mockDb = {
      tenantTx: vi.fn(),
      prisma: {
        googleCalendarSync: {
          findFirst: vi.fn(),
        },
      },
    };
    const mockBox = { encrypt: vi.fn(), decrypt: vi.fn() };
    const mockEnv = { GOOGLE_CALENDAR_MODE: 'mock' };

    const svc = new GoogleCalendarService(mockDb as any, mockBox as any, mockEnv as any);
    const controller = new GoogleCalendarWebhookController(svc);

    const res = await controller.handleWebhook('channel-123', 'sync');
    expect(res).toEqual({ ok: true, action: 'synced' });
  });

  it('ignores webhooks when mode is off', async () => {
    const mockDb = {
      tenantTx: vi.fn(),
      prisma: {
        googleCalendarSync: {
          findFirst: vi.fn(),
        },
      },
    };
    const mockBox = { encrypt: vi.fn(), decrypt: vi.fn() };
    const mockEnv = { GOOGLE_CALENDAR_MODE: 'off' };

    const svc = new GoogleCalendarService(mockDb as any, mockBox as any, mockEnv as any);
    const controller = new GoogleCalendarWebhookController(svc);

    const res = await controller.handleWebhook('channel-123', 'exists');
    expect(res).toEqual({ ok: true, action: 'ignored' });
  });

  it('reconciles calendar when channel is active', async () => {
    const mockSync = {
      id: 'sync-1',
      tenantId: 'tenant-1',
      membershipId: 'mem-1',
      channelId: 'channel-123',
      calendarId: 'primary',
      status: 'active',
    };

    const mockDb = {
      prisma: {
        googleCalendarSync: {
          findFirst: vi.fn().mockResolvedValue(mockSync),
        },
      },
      tenantTx: vi.fn().mockImplementation((_ctx, fn) => {
        const tx = {
          googleCalendarSync: {
            findUnique: vi.fn().mockResolvedValue(mockSync),
            update: vi.fn().mockResolvedValue(mockSync),
          },
          appointment: {
            findFirst: vi.fn(),
            update: vi.fn(),
          },
          leadActivity: {
            create: vi.fn(),
          },
        };
        return fn(tx);
      }),
    };
    const mockBox = { encrypt: vi.fn(), decrypt: vi.fn() };
    const mockEnv = { GOOGLE_CALENDAR_MODE: 'mock' };

    const svc = new GoogleCalendarService(mockDb as any, mockBox as any, mockEnv as any);
    const controller = new GoogleCalendarWebhookController(svc);

    const res = await controller.handleWebhook('channel-123', 'exists');
    expect(res).toMatchObject({ ok: true, action: 'reconciled' });
  });
});
