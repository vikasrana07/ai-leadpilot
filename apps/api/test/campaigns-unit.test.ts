import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import type { WhatsAppClient } from '../src/whatsapp/whatsapp.client.js';
import type { CampaignTemplateParam } from '@leadpilot/validation';

describe('CampaignsService Unit Tests', () => {
  let service: CampaignsService;
  let mockDbService: any;
  let mockAuditService: any;
  let mockChannelsService: any;
  let mockWaClient: WhatsAppClient;

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '11111111-1111-1111-1111-111111111111';
  const channelId = '22222222-2222-2222-2222-222222222222';
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

      const lead3 = { id: 'lead-3', phone: '+919876543212', phoneNorm: '919876543212' };

      // lead-1 opted in, lead-2 later sent STOP, lead-3 has no consent record at all (e.g. imported from CSV)
      const consents = [
        { leadId: 'lead-2', channel: 'whatsapp', status: 'OPTED_OUT', createdAt: new Date() },
        { leadId: 'lead-2', channel: 'whatsapp', status: 'OPTED_IN', createdAt: new Date(Date.now() - 1000) },
        { leadId: 'lead-1', channel: 'whatsapp', status: 'OPTED_IN', createdAt: new Date() },
      ];
      const created: Array<{ leadId: string; status: string }> = [];
      const campaignUpdates: Array<Record<string, unknown>> = [];

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue({
              id: campaignId,
              tenantId,
              status: 'DRAFT',
              segment: { stageIds: [] },
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            update: vi.fn().mockImplementation((args: any) => { campaignUpdates.push(args.data); return Promise.resolve({ id: campaignId, status: 'RUNNING' }); }),
          },
          lead: {
            findMany: vi.fn().mockResolvedValue([lead1, lead2, lead3]),
          },
          consent: {
            findMany: vi.fn().mockResolvedValue(consents),
          },
          broadcastRecipient: {
            createMany: vi.fn().mockImplementation((args: any) => { created.push(...args.data); return Promise.resolve({ count: args.data.length }); }),
          },
        };
        return fn(mockTx as any);
      });

      service.enqueueDispatch = vi.fn().mockResolvedValue(undefined);

      const result = await service.launch({ tenantId, userId }, campaignId);
      expect(result.status).toBe('RUNNING');
      expect(service.enqueueDispatch).toHaveBeenCalledWith(tenantId, campaignId);
      // Only the explicitly opted-in lead is sendable; the STOP (latest wins) and the never-asked lead are skipped for different reasons.
      expect(Object.fromEntries(created.map((c) => [c.leadId, c.status]))).toEqual({
        'lead-1': 'PENDING', 'lead-2': 'SKIPPED_OPT_OUT', 'lead-3': 'SKIPPED_NO_CONSENT',
      });
      expect(campaignUpdates[0]).toMatchObject({ totalRecipients: 3, optOutCount: 1, noConsentCount: 1 });
    });

    it('completes immediately and sends nothing when nobody in the audience has opted in', async () => {
      let status = '';
      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => fn({
        broadcastCampaign: { findFirst: vi.fn().mockResolvedValue({ id: campaignId, tenantId, status: 'DRAFT', segment: {} }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockImplementation((a: any) => { status = a.data.status; return Promise.resolve({}); }) },
        lead: { findMany: vi.fn().mockResolvedValue([{ id: 'lead-9', phone: '+919876543299', phoneNorm: '919876543299' }]) },
        consent: { findMany: vi.fn().mockResolvedValue([]) },
        broadcastRecipient: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      } as any));
      service.enqueueDispatch = vi.fn();
      const result = await service.launch({ tenantId, userId }, campaignId);
      expect(result.status).toBe('COMPLETED');
      expect(status).toBe('COMPLETED');
      expect(service.enqueueDispatch).not.toHaveBeenCalled();
    });

    it('previews audience count with accurate opt-out split', async () => {
      const lead1 = { id: 'lead-1', name: 'John Doe', phone: '+919876543210', phoneNorm: '919876543210', score: 85, stage: { name: 'Site Visit' } };
      const lead2 = { id: 'lead-2', name: 'Jane Smith', phone: '+919876543211', phoneNorm: '919876543211', score: 90, stage: { name: 'Site Visit' } };
      const lead3 = { id: 'lead-3', name: 'Imported Ivan', phone: '+919876543212', phoneNorm: '919876543212', score: 10, stage: { name: 'New' } };

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          lead: {
            findMany: vi.fn().mockResolvedValue([lead1, lead2, lead3]),
          },
          consent: {
            findMany: vi.fn().mockResolvedValue([
              { leadId: 'lead-2', channel: 'whatsapp', status: 'OPTED_OUT', createdAt: new Date() },
              { leadId: 'lead-1', channel: 'whatsapp', status: 'OPTED_IN', createdAt: new Date() },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      const preview = await service.previewAudience(
        { tenantId, userId } as any,
        { segment: { stageIds: [], tagIds: [], sourceIds: [], temperatures: [] } },
      );

      expect(preview.totalMatching).toBe(3);
      expect(preview.eligibleCount).toBe(1);
      expect(preview.optOutCount).toBe(1);
      expect(preview.noConsentCount).toBe(1);
      expect(preview.sampleLeads[0]?.name).toBe('John Doe');
      expect(preview.sampleLeads[0]?.isOptedOut).toBe(false);
      expect(preview.sampleLeads[1]?.name).toBe('Jane Smith');
      expect(preview.sampleLeads[1]?.isOptedOut).toBe(true);
      expect(preview.sampleLeads.map((l) => l.consent)).toEqual(['ELIGIBLE', 'OPTED_OUT', 'NO_CONSENT']);
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
        leadId: 'lead-1',
        phone: '919876543210',
        status: 'PENDING',
        lead: { id: 'lead-1', name: 'Bob Smith', assignedMembershipId: null },
      };

      const queryRaw = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'recip-1' }]); // 1st: stale-claim reaper, 2nd: atomic claim
      let findManyCall = 0;
      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          $queryRaw: queryRaw,
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue(campaign),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
          consent: { findMany: vi.fn().mockResolvedValue([{ leadId: 'lead-1', status: 'OPTED_IN' }]) },
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
        leadId: 'lead-1',
        phone: '919999999999',
        status: 'PENDING',
        lead: { id: 'lead-1', name: 'Invalid User' },
      };

      const queryRaw = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'recip-1' }]); // 1st: stale-claim reaper, 2nd: atomic claim
      let updatedRecipientStatus = '';
      let campaignFailedIncrement = false;

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          $queryRaw: queryRaw,
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue(campaign),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
          consent: { findMany: vi.fn().mockResolvedValue([{ leadId: 'lead-1', status: 'OPTED_IN' }]) },
        };
        return fn(mockTx as any);
      });

      const result = await service.dispatchBatch(tenantId, campaignId, 1);
      expect(result.processed).toBe(1);
      expect(updatedRecipientStatus).toBe('FAILED');
      expect(campaignFailedIncrement).toBe(true);
    });
  });

  describe('Consent at send time and opt-in recording', () => {
    it('does not send to a recipient who sent STOP after launch, and counts them as opted out', async () => {
      const campaign = { id: campaignId, tenantId, status: 'RUNNING', channelId, templateName: 't', templateLanguage: 'en', templateParams: [] };
      const recipient = { id: 'recip-1', campaignId, leadId: 'lead-1', phone: '919876543210', status: 'PENDING', lead: { id: 'lead-1', name: 'Bob' } };
      const queryRaw = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'recip-1' }]); // 1st: stale-claim reaper, 2nd: atomic claim
      const updates: Array<Record<string, unknown>> = [];
      const campaignUpdates: Array<Record<string, unknown>> = [];
      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => fn({
        $queryRaw: queryRaw,
        broadcastCampaign: { findFirst: vi.fn().mockResolvedValue(campaign), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockImplementation((a: any) => { campaignUpdates.push(a.data); return Promise.resolve(campaign); }) },
        broadcastRecipient: { findMany: vi.fn().mockResolvedValue([recipient]), count: vi.fn().mockResolvedValue(0), update: vi.fn().mockImplementation((a: any) => { updates.push(a.data); return Promise.resolve({}); }) },
        consent: { findMany: vi.fn().mockResolvedValue([{ leadId: 'lead-1', status: 'OPTED_OUT' }, { leadId: 'lead-1', status: 'OPTED_IN' }]) },
      } as any));
      await service.dispatchBatch(tenantId, campaignId, 10);
      expect(mockWaClient.sendTemplate).not.toHaveBeenCalled();
      expect(updates).toContainEqual({ status: 'SKIPPED_OPT_OUT' });
      expect(campaignUpdates).toContainEqual({ optOutCount: { increment: 1 } });
    });

    it('records an attested opt-in only for leads with no consent record, never overriding a STOP', async () => {
      const created: Array<Record<string, unknown>> = [];
      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => fn({
        lead: { findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) },
        consent: {
          findMany: vi.fn().mockResolvedValue([{ leadId: 'b', status: 'OPTED_IN' }, { leadId: 'c', status: 'OPTED_OUT' }]),
          createMany: vi.fn().mockImplementation((args: any) => { created.push(...args.data); return Promise.resolve({ count: args.data.length }); }),
        },
      } as any));
      const res = await service.recordWhatsappOptIn({ tenantId, userId } as any, { leadIds: ['a', 'b', 'c', 'missing'], basis: 'existing_customer', attestation: true });
      expect(res).toEqual({ recorded: 1, alreadyOptedIn: 1, skippedOptedOut: 1, notFound: 1 });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ leadId: 'a', status: 'OPTED_IN', channel: 'whatsapp', source: 'manager_attested:existing_customer' });
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

  describe('Follow-up Campaigns & Auto-Retries', () => {
    it('creates a targeted follow-up campaign for READ_NO_REPLY cohort', async () => {
      const parentCampaign = {
        id: campaignId,
        name: 'Festive Sale',
        channelId,
        templateId: 'tmpl-1',
        template: {
          id: 'tmpl-1',
          name: 'festive_offer',
          language: 'en',
          category: 'MARKETING',
        },
        templateParams: [],
        status: 'COMPLETED',
      };

      const cohortRecipients = [
        { leadId: 'lead-1', lead: { id: 'lead-1', name: 'Alice', phone: '+1234567890' } },
        { leadId: 'lead-2', lead: { id: 'lead-2', name: 'Bob', phone: '+1234567891' } },
      ];

      let createdCampaign: any;
      let createdRecipients: any[] = [];

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue(parentCampaign),
            create: vi.fn().mockImplementation((args: any) => {
              createdCampaign = { id: 'follow-up-1', ...args.data };
              return Promise.resolve(createdCampaign);
            }),
          },
          broadcastRecipient: {
            findMany: vi.fn().mockResolvedValue(cohortRecipients),
            createMany: vi.fn().mockImplementation((args: any) => {
              createdRecipients = args.data;
              return Promise.resolve({ count: args.data.length });
            }),
          },
          consent: {
            findMany: vi.fn().mockResolvedValue([
              { leadId: 'lead-1', status: 'OPTED_IN' },
              { leadId: 'lead-2', status: 'OPTED_IN' },
            ]),
          },
        };
        return fn(mockTx as any);
      });

      const res = await service.createFollowUp({ tenantId, userId } as any, campaignId, {
        name: 'Festive Sale - Follow-up',
        cohort: 'READ_NO_REPLY',
        templateName: 'festive_reminder',
      });

      expect(res.id).toBeDefined();
      expect(res.id).toBe(createdCampaign.id);
      expect(createdCampaign.parentCampaignId).toBe(campaignId);
      expect(createdCampaign.followUpCohort).toBe('READ_NO_REPLY');
      expect(createdCampaign.totalRecipients).toBe(2);
      expect(createdRecipients).toHaveLength(2);
      expect(createdRecipients[0].leadId).toBe('lead-1');
    });

    it('resets transient failures when retrying failed recipients', async () => {
      const parentCampaign = {
        id: campaignId,
        name: 'Festive Sale',
        channelId,
        autoRetry: true,
        autoRetryCount: 0,
        status: 'COMPLETED',
      };

      let updatedCampaign: any = null;

      mockDbService.tenantTx = vi.fn(async (_ctx, fn) => {
        const mockTx = {
          broadcastCampaign: {
            findFirst: vi.fn().mockResolvedValue(parentCampaign),
            updateMany: vi.fn().mockImplementation((args: any) => {
              updatedCampaign = args.data;
              return Promise.resolve({ count: 1 });
            }),
          },
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'recip-1' }]),
          $executeRaw: vi.fn().mockResolvedValue(1),
        };
        return fn(mockTx as any);
      });

      const res = await service.retryFailed({ tenantId, userId } as any, campaignId);
      expect(res.retried).toBe(1);
      expect(updatedCampaign.status).toBe('RUNNING');
    });
  });
});
