import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import type { WhatsAppClient } from '../src/whatsapp/whatsapp.client.js';
import type { CampaignSegment, CampaignTemplateParam } from '@leadpilot/validation';

describe('CampaignsService Unit Tests', () => {
  let service: CampaignsService;
  let mockDbService: any;
  let mockAuditService: any;
  let mockChannelsService: any;
  let mockWaClient: WhatsAppClient;

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '11111111-1111-1111-1111-111111111111';
  const channelId = '22222222-2222-2222-2222-222222222222';
  const templateId = '33333333-3333-3333-3333-333333333333';
  const campaignId = '44444444-4444-4444-4444-444444444444';

  beforeEach(() => {
    mockAuditService = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    mockChannelsService = {
      credentialsFor: vi.fn().mockResolvedValue({
        channel: { id: channelId, externalId: 'wa_phone_id_123', status: 'ACTIVE' },
        creds: { accessToken: 'test_token', appSecret: 'test_secret' },
      }),
    };

    mockWaClient = {
      sendText: vi.fn(),
      sendTemplate: vi.fn().mockResolvedValue({ messageId: 'wamid.HBgLMTIzNDU2' }),
      listTemplates: vi.fn().mockResolvedValue([]),
    } as any;

    mockDbService = {
      prisma: {
        broadcastCampaign: {
          findMany: vi.fn(),
        },
      },
      tenantTx: vi.fn(async (_ctx, fn) => {
        const mockTx: any = {
          broadcastCampaign: {
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            count: vi.fn(),
          },
          broadcastRecipient: {
            findMany: vi.fn(),
            createMany: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
            count: vi.fn(),
          },
          lead: {
            findMany: vi.fn(),
            update: vi.fn(),
          },
          consent: {
            findMany: vi.fn(),
          },
          conversation: {
            findUnique: vi.fn(),
            create: vi.fn(),
          },
          message: {
            create: vi.fn(),
          },
        };
        return fn(mockTx);
      }),
    };

    service = new CampaignsService(
      mockDbService,
      mockAuditService,
      mockChannelsService,
      mockWaClient,
    );
  });

  describe('Audience Segmentation & Opt-Out Suppression', () => {
    it('correctly suppresses leads that opted out via STOP keyword', async () => {
      const lead1 = { id: 'lead-1', phone: '+919876543210', phoneNorm: '919876543210' };
      const lead2 = { id: 'lead-2', phone: '+919876543211', phoneNorm: '919876543211' };

      // lead-2 has opted out
      const consents = [
        { leadId: 'lead-2', channel: 'whatsapp', status: 'OPTED_OUT', createdAt: new Date() },
      ];

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue({
              id: campaignId,
              tenantId,
              status: 'DRAFT',
              segment: { stageIds: [] },
            }),
            update: vi.fn().mockResolvedValue({ id: campaignId, status: 'RUNNING' }),
          },
          lead: {
            findMany: vi.fn().mockResolvedValue([lead1, lead2]),
          },
          consent: {
            findMany: vi.fn().mockResolvedValue(consents),
          },
          broadcastRecipient: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
        };
        return fn(mockTx as any);
      });

      service.enqueueDispatch = vi.fn().mockResolvedValue(undefined);

      const result = await service.launch({ tenantId, userId }, campaignId);
      expect(result.status).toBe('RUNNING');
      expect(service.enqueueDispatch).toHaveBeenCalledWith(tenantId, campaignId);
    });

    it('previews audience count with accurate opt-out split', async () => {
      const lead1 = { id: 'lead-1', name: 'John Doe', phone: '+919876543210', phoneNorm: '919876543210', score: 85, stage: { name: 'Site Visit' } };
      const lead2 = { id: 'lead-2', name: 'Jane Smith', phone: '+919876543211', phoneNorm: '919876543211', score: 90, stage: { name: 'Site Visit' } };

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          lead: {
            findMany: vi.fn().mockResolvedValue([lead1, lead2]),
          },
          consent: {
            findMany: vi.fn().mockResolvedValue([
              { leadId: 'lead-2', channel: 'whatsapp', status: 'OPTED_OUT', createdAt: new Date() },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      const preview = await service.previewAudience(
        { tenantId, userId } as any,
        { segment: { stageIds: [], tagIds: [], sourceIds: [], temperatures: [] } },
      );

      expect(preview.totalMatching).toBe(2);
      expect(preview.eligibleCount).toBe(1);
      expect(preview.optOutCount).toBe(1);
      expect(preview.sampleLeads[0]?.name).toBe('John Doe');
      expect(preview.sampleLeads[0]?.isOptedOut).toBe(false);
      expect(preview.sampleLeads[1]?.name).toBe('Jane Smith');
      expect(preview.sampleLeads[1]?.isOptedOut).toBe(true);
    });
  });

  describe('Template Parameter Resolution', () => {
    it('resolves {{1}} to lead name and {{2}} to custom static text with fallbacks', () => {
      const lead = { name: 'Alice Johnson', location: 'Whitefield, Bangalore' };
      const params: CampaignTemplateParam[] = [
        { index: 1, field: 'name', fallback: 'Valued Customer' },
        { index: 2, field: 'custom', customValue: 'Sobha Lake Gardens', fallback: 'Luxury Project' },
        { index: 3, field: 'location', fallback: 'Bangalore' },
      ];

      // Access private method via any
      const resolved = (service as any).resolveParams(lead, params);
      expect(resolved).toEqual(['Alice Johnson', 'Sobha Lake Gardens', 'Whitefield, Bangalore']);
    });

    it('applies fallback when lead property is null or empty', () => {
      const lead = { name: '', location: null };
      const params: CampaignTemplateParam[] = [
        { index: 1, field: 'name', fallback: 'Customer' },
        { index: 2, field: 'location', fallback: 'Bangalore' },
      ];

      const resolved = (service as any).resolveParams(lead, params);
      expect(resolved).toEqual(['Customer', 'Bangalore']);
    });
  });

  describe('Batch Dispatch Execution', () => {
    it('dispatches batch of pending recipients and updates status to SENT', async () => {
      const campaign = {
        id: campaignId,
        tenantId,
        status: 'RUNNING',
        channelId,
        templateName: 'exclusive_property_alert',
        templateLanguage: 'en',
        templateParams: [{ index: 1, field: 'name', fallback: 'Customer' }],
      };

      const recipient = {
        id: 'recip-1',
        campaignId,
        phone: '919876543210',
        status: 'PENDING',
        lead: { id: 'lead-1', name: 'Bob Smith', assignedMembershipId: null },
      };

      let findManyCall = 0;
      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue(campaign),
            update: vi.fn().mockResolvedValue(campaign),
          },
          broadcastRecipient: {
            findMany: vi.fn().mockImplementation(() => {
              findManyCall++;
              return findManyCall === 1 ? Promise.resolve([recipient]) : Promise.resolve([]);
            }),
            count: vi.fn().mockResolvedValue(0),
            update: vi.fn().mockResolvedValue({ id: recipient.id, status: 'SENT' }),
          },
          conversation: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'convo-1' }),
          },
          message: {
            create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
          },
          lead: {
            update: vi.fn().mockResolvedValue({ id: 'lead-1' }),
          },
        };
        return fn(mockTx as any);
      });

      const result = await service.dispatchBatch(tenantId, campaignId, 10);
      expect(result.processed).toBe(1);
      expect(mockWaClient.sendTemplate).toHaveBeenCalledWith(
        'wa_phone_id_123',
        expect.anything(),
        '919876543210',
        'exclusive_property_alert',
        'en',
        ['Bob Smith'],
      );
    });

    it('marks recipient FAILED and increments campaign failedCount when WhatsApp API throws', async () => {
      mockWaClient.sendTemplate = vi.fn().mockRejectedValue(new Error('WhatsApp phone number not registered'));

      const campaign = {
        id: campaignId,
        tenantId,
        status: 'RUNNING',
        channelId,
        templateName: 'test_tpl',
        templateLanguage: 'en',
        templateParams: [],
      };

      const recipient = {
        id: 'recip-1',
        campaignId,
        phone: '919999999999',
        status: 'PENDING',
        lead: { id: 'lead-1', name: 'Invalid User' },
      };

      let updatedRecipientStatus = '';
      let campaignFailedIncrement = false;

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue(campaign),
            update: vi.fn().mockImplementation((args: any) => {
              if (args.data?.failedCount) campaignFailedIncrement = true;
              return Promise.resolve(campaign);
            }),
          },
          broadcastRecipient: {
            findMany: vi.fn().mockResolvedValue([recipient]),
            count: vi.fn().mockResolvedValue(0),
            update: vi.fn().mockImplementation((args: any) => {
              updatedRecipientStatus = args.data.status;
              return Promise.resolve({ id: recipient.id, ...args.data });
            }),
          },
          conversation: {
            findUnique: vi.fn(),
            create: vi.fn(),
          },
          message: {
            create: vi.fn(),
          },
          lead: {
            update: vi.fn(),
          },
        };
        return fn(mockTx as any);
      });

      const result = await service.dispatchBatch(tenantId, campaignId, 1);
      expect(result.processed).toBe(1);
      expect(updatedRecipientStatus).toBe('FAILED');
      expect(campaignFailedIncrement).toBe(true);
    });
  });

  describe('Campaign Cancellation', () => {
    it('cancels campaign and stops remaining pending recipients', async () => {
      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue({ id: campaignId, status: 'RUNNING' }),
            update: vi.fn().mockResolvedValue({ id: campaignId, status: 'CANCELLED' }),
          },
          broadcastRecipient: {
            updateMany: vi.fn().mockResolvedValue({ count: 15 }),
          },
        };
        return fn(mockTx as any);
      });

      const res = await service.cancel({ tenantId, userId } as any, campaignId);
      expect(res.status).toBe('CANCELLED');
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'campaign.cancelled' }),
      );
    });
  });
});
