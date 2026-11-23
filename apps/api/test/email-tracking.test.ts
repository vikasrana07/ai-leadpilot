import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTrackingService } from '../src/email-tracking/email-tracking.service.js';
import type { Env } from '../src/config/env.js';
import type { MailService } from '../src/mail/mail.module.js';
import type { DbService } from '../src/db/db.module.js';

describe('EmailTrackingService', () => {
  const tenantId = '11111111-1111-7111-8111-111111111111';
  const userId = '22222222-2222-7222-8222-222222222222';
  const leadId = '33333333-3333-7333-8333-333333333333';

  const mockEnv: Env = {
    NODE_ENV: 'test',
    TRACKING_SECRET: 'test-super-secret-tracking-key-123456',
    TRACKING_BASE_URL: 'https://track.leadpilot.io',
    WEB_ORIGIN: 'https://app.leadpilot.io',
    SES_TRACKING_MODE: 'mock',
    SES_CONFIGURATION_SET: 'leadpilot-events',
    JWT_ACCESS_SECRET: 'test-jwt-secret-at-least-48-characters-long-1234567890',
  } as unknown as Env;

  // In-memory mock database state
  let trackedEmails: any[] = [];
  let emailEngagementEvents: any[] = [];
  let emailSuppressions: any[] = [];
  let leadActivities: any[] = [];

  const mockTx = {
    emailSuppression: {
      findUnique: vi.fn(async ({ where }: any) => {
        return emailSuppressions.find(
          (s) => s.tenantId === where.tenantId_email.tenantId && s.email === where.tenantId_email.email,
        ) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return emailSuppressions.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null;
      }),
      findMany: vi.fn(async () => emailSuppressions),
      count: vi.fn(async () => emailSuppressions.length),
      create: vi.fn(async ({ data }: any) => {
        const item = { ...data, createdAt: new Date() };
        emailSuppressions.push(item);
        return item;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const idx = emailSuppressions.findIndex(
          (s) => s.tenantId === where.tenantId_email.tenantId && s.email === where.tenantId_email.email,
        );
        if (idx >= 0) {
          emailSuppressions[idx] = { ...emailSuppressions[idx], ...update };
          return emailSuppressions[idx];
        } else {
          const item = { ...create, createdAt: new Date() };
          emailSuppressions.push(item);
          return item;
        }
      }),
      delete: vi.fn(async ({ where }: any) => {
        emailSuppressions = emailSuppressions.filter((s) => s.id !== where.id);
      }),
    },
    trackedEmail: {
      findUnique: vi.fn(async ({ where }: any) => {
        return trackedEmails.find((e) => e.id === where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id) return trackedEmails.find((e) => e.id === where.id) ?? null;
        if (where.OR) {
          const sesId = where.OR[0].sesMessageId;
          return trackedEmails.find((e) => e.sesMessageId === sesId || e.smtpMessageId === sesId) ?? null;
        }
        return trackedEmails[0] ?? null;
      }),
      findMany: vi.fn(async () => trackedEmails),
      count: vi.fn(async () => trackedEmails.length),
      groupBy: vi.fn(async () => {
        const counts: Record<string, number> = {};
        for (const e of trackedEmails) {
          counts[e.status] = (counts[e.status] || 0) + 1;
        }
        return Object.entries(counts).map(([status, count]) => ({ status, _count: { _all: count } }));
      }),
      create: vi.fn(async ({ data }: any) => {
        const item = {
          ...data,
          openCount: 0,
          clickCount: 0,
          firstOpenedAt: null,
          lastOpenedAt: null,
          deliveredAt: null,
          bouncedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        trackedEmails.push(item);
        return item;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = trackedEmails.findIndex((e) => e.id === where.id);
        if (idx === -1) throw new Error('Not found');
        const cur = trackedEmails[idx];
        const updated = { ...cur, ...data };
        if (data.openCount?.increment) updated.openCount = (cur.openCount || 0) + data.openCount.increment;
        if (data.clickCount?.increment) updated.clickCount = (cur.clickCount || 0) + data.clickCount.increment;
        trackedEmails[idx] = updated;
        return updated;
      }),
    },
    emailEngagementEvent: {
      create: vi.fn(async ({ data }: any) => {
        const item = { ...data, timestamp: data.timestamp ?? new Date() };
        emailEngagementEvents.push(item);
        return item;
      }),
    },
    leadActivity: {
      create: vi.fn(async ({ data }: any) => {
        const item = { ...data, createdAt: new Date() };
        leadActivities.push(item);
        return item;
      }),
    },
  };

  const mockDbService = {
    tenantTx: vi.fn(async (_ctx: any, fn: any) => fn(mockTx)),
    userTx: vi.fn(async (_ctx: any, fn: any) => fn(mockTx)),
  } as unknown as DbService;

  const mockMailService = {
    sendCustom: vi.fn(async () => ({ messageId: '0100018test-message-id@email.amazonses.com' })),
  } as unknown as MailService;

  let service: EmailTrackingService;

  beforeEach(() => {
    trackedEmails = [];
    emailEngagementEvents = [];
    emailSuppressions = [];
    leadActivities = [];
    vi.clearAllMocks();
    service = new EmailTrackingService(mockDbService, mockEnv, mockMailService);
  });

  describe('Tokens & HTML Instrumentation', () => {
    it('signs and verifies open tokens correctly', () => {
      const token = service.signToken({ e: 'email-1', t: tenantId, type: 'open' });
      const verified = service.verifyToken<any>(token);
      expect(verified.e).toBe('email-1');
      expect(verified.t).toBe(tenantId);
      expect(verified.type).toBe('open');
    });

    it('rejects tampered tokens', () => {
      const token = service.signToken({ e: 'email-1', t: tenantId, type: 'open' });
      const tampered = token.slice(0, -4) + 'abcd';
      expect(() => service.verifyToken(tampered)).toThrow(/Invalid or forged tracking token/);
    });

    it('injects 1x1 open pixel and wraps links in html', async () => {
      const htmlInput = '<html><body><p>Hello</p><a href="https://example.com/brochure">Brochure</a></body></html>';
      const result = await service.sendTrackedEmail(
        { tenantId, userId },
        { to: 'prospect@gmail.com', leadId, subject: 'Brochure', text: 'Hello', html: htmlInput },
      );

      expect(result.status).toBe('SENT');
      expect(mockMailService.sendCustom).toHaveBeenCalled();

      const callArgs = (mockMailService.sendCustom as any).mock.calls[0][0];
      expect(callArgs.html).toContain('https://track.leadpilot.io/track/open/');
      expect(callArgs.html).toContain('https://track.leadpilot.io/track/click/');
      expect(callArgs.headers['X-SES-CONFIGURATION-SET']).toBe('leadpilot-events');
      expect(callArgs.headers['X-SES-MESSAGE-TAGS']).toContain(`tenantId=${tenantId}`);

      // Verified LeadActivity
      expect(leadActivities.length).toBe(1);
      expect(leadActivities[0].type).toBe('email_sent');
    });
  });

  describe('Suppression Engine', () => {
    it('blocks outbound email if recipient is suppressed', async () => {
      emailSuppressions.push({
        id: 'supp-1',
        tenantId,
        email: 'bounced@gmail.com',
        reason: 'HARD_BOUNCE',
        source: 'ses_bounce',
        notes: 'User unknown',
        createdAt: new Date(),
      });

      const res = await service.sendTrackedEmail(
        { tenantId, userId },
        { to: 'bounced@gmail.com', leadId, subject: 'Follow up', text: 'Hello' },
      );

      expect(res.status).toBe('SUPPRESSED');
      expect(res.suppressed).toBe(true);
      expect(mockMailService.sendCustom).not.toHaveBeenCalled();

      const tracked = trackedEmails.find((e) => e.recipient === 'bounced@gmail.com');
      expect(tracked).toBeDefined();
      expect(tracked.status).toBe('SUPPRESSED');
    });

    it('allows manually adding and removing suppressions', async () => {
      const added = await service.addSuppression(tenantId, {
        email: 'optout@example.com',
        reason: 'MANUAL',
        notes: 'Requested via call',
      });
      expect(added.email).toBe('optout@example.com');
      expect(emailSuppressions.length).toBe(1);

      await service.removeSuppression(tenantId, added.id);
      expect(emailSuppressions.length).toBe(0);
    });
  });

  describe('Open & Click Web Triggers', () => {
    it('records open pixel hits and increments open counter', async () => {
      const sendRes = await service.sendTrackedEmail(
        { tenantId, userId },
        { to: 'client@gmail.com', leadId, subject: 'Pricing', text: 'Details inside' },
      );

      const openToken = service.signToken({ e: sendRes.id, t: tenantId, type: 'open' });
      await service.recordOpenToken(openToken, '192.168.1.100', 'Mozilla/5.0');

      const email = trackedEmails.find((e) => e.id === sendRes.id);
      expect(email.openCount).toBe(1);
      expect(email.status).toBe('OPENED');
      expect(emailEngagementEvents.length).toBe(1);
      expect(emailEngagementEvents[0].type).toBe('OPEN');

      const openActivity = leadActivities.find((a) => a.type === 'email_opened');
      expect(openActivity).toBeDefined();
    });

    it('records click hits, increments click counter and returns target url', async () => {
      const sendRes = await service.sendTrackedEmail(
        { tenantId, userId },
        { to: 'client@gmail.com', leadId, subject: 'Pricing', text: 'Details inside' },
      );

      const clickToken = service.signToken({
        e: sendRes.id,
        t: tenantId,
        u: 'https://leadpilot.io/book-viewing',
        type: 'click',
      });

      const destination = await service.recordClickToken(clickToken, '10.0.0.1', 'Chrome/120');
      expect(destination).toBe('https://leadpilot.io/book-viewing');

      const email = trackedEmails.find((e) => e.id === sendRes.id);
      expect(email.clickCount).toBe(1);
      expect(email.status).toBe('CLICKED');

      const clickActivity = leadActivities.find((a) => a.type === 'email_clicked');
      expect(clickActivity).toBeDefined();
      expect(clickActivity.data.url).toBe('https://leadpilot.io/book-viewing');
    });
  });

  describe('Amazon SNS / SES Notification Ingestion', () => {
    it('processes SES Delivery notification', async () => {
      const sendRes = await service.sendTrackedEmail(
        { tenantId, userId },
        { to: 'verified@gmail.com', leadId, subject: 'Welcome', text: 'Hi' },
      );

      const snsDeliveryMsg = {
        Type: 'Notification' as const,
        MessageId: 'sns-msg-1',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:ses-events',
        Message: JSON.stringify({
          eventType: 'Delivery',
          mail: {
            messageId: sendRes.messageId,
            tags: { emailId: [sendRes.id], tenantId: [tenantId] },
          },
          delivery: {
            timestamp: '2026-11-23T10:00:00.000Z',
            processingTimeMillis: 300,
            smtpResponse: '250 2.1.5 Ok',
          },
        }),
        Timestamp: '2026-11-23T10:00:00.000Z',
        SignatureVersion: '1',
        Signature: 'fake',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      };

      const res = await service.handleSnsMessage(snsDeliveryMsg);
      expect(res.status).toBe('processed');

      const email = trackedEmails.find((e) => e.id === sendRes.id);
      expect(email.status).toBe('DELIVERED');
      expect(leadActivities.some((a) => a.type === 'email_delivered')).toBe(true);
    });

    it('processes Permanent Hard Bounce and auto-suppresses recipient', async () => {
      const sendRes = await service.sendTrackedEmail(
        { tenantId, userId },
        { to: 'bad-email@nowhere-fake.org', leadId, subject: 'Test Bounce', text: 'Ping' },
      );

      const snsBounceMsg = {
        Type: 'Notification' as const,
        MessageId: 'sns-msg-2',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:ses-events',
        Message: JSON.stringify({
          eventType: 'Bounce',
          mail: {
            messageId: sendRes.messageId,
            tags: { emailId: [sendRes.id], tenantId: [tenantId] },
          },
          bounce: {
            bounceType: 'Permanent',
            bounceSubType: 'General',
            bouncedRecipients: [
              {
                emailAddress: 'bad-email@nowhere-fake.org',
                diagnosticCode: 'smtp; 550 5.1.1 User unknown',
              },
            ],
          },
        }),
        Timestamp: '2026-11-23T10:00:00.000Z',
        SignatureVersion: '1',
        Signature: 'fake',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      };

      await service.handleSnsMessage(snsBounceMsg);

      const email = trackedEmails.find((e) => e.id === sendRes.id);
      expect(email.status).toBe('BOUNCED');
      expect(email.bounceType).toBe('Permanent');

      // Auto-suppression must be created
      const suppression = emailSuppressions.find((s) => s.email === 'bad-email@nowhere-fake.org');
      expect(suppression).toBeDefined();
      expect(suppression.reason).toBe('HARD_BOUNCE');
      expect(suppression.notes).toContain('550 5.1.1 User unknown');
    });

    it('processes Spam Complaint and auto-suppresses recipient', async () => {
      const sendRes = await service.sendTrackedEmail(
        { tenantId, userId },
        { to: 'unhappy@prospect.com', leadId, subject: 'Offer', text: 'Exclusive' },
      );

      const snsComplaintMsg = {
        Type: 'Notification' as const,
        MessageId: 'sns-msg-3',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:ses-events',
        Message: JSON.stringify({
          eventType: 'Complaint',
          mail: {
            messageId: sendRes.messageId,
            tags: { emailId: [sendRes.id], tenantId: [tenantId] },
          },
          complaint: {
            complaintFeedbackType: 'abuse',
          },
        }),
        Timestamp: '2026-11-23T10:00:00.000Z',
        SignatureVersion: '1',
        Signature: 'fake',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      };

      await service.handleSnsMessage(snsComplaintMsg);

      const email = trackedEmails.find((e) => e.id === sendRes.id);
      expect(email.status).toBe('COMPLAINED');
      expect(email.complaintFeedbackType).toBe('abuse');

      const suppression = emailSuppressions.find((s) => s.email === 'unhappy@prospect.com');
      expect(suppression).toBeDefined();
      expect(suppression.reason).toBe('COMPLAINT');
    });
  });

  describe('Stats calculation', () => {
    it('computes rates accurately', async () => {
      trackedEmails = [
        { status: 'DELIVERED', tenantId },
        { status: 'OPENED', tenantId },
        { status: 'CLICKED', tenantId },
        { status: 'BOUNCED', tenantId },
        { status: 'SUPPRESSED', tenantId },
      ];

      const stats = await service.getStats(tenantId);
      expect(stats.totalSent).toBe(4); // DELIVERED + OPENED + CLICKED + BOUNCED
      expect(stats.delivered).toBe(3); // DELIVERED + OPENED + CLICKED
      expect(stats.opened).toBe(2); // OPENED + CLICKED
      expect(stats.clicked).toBe(1);
      expect(stats.bounced).toBe(1);
      expect(stats.suppressed).toBe(1);
      expect(stats.deliveryRatePercent).toBe(75); // 3 / 4 * 100
      expect(stats.openRatePercent).toBe(66.7); // 2 / 3 * 100
      expect(stats.clickRatePercent).toBe(50); // 1 / 2 * 100
      expect(stats.bounceRatePercent).toBe(25); // 1 / 4 * 100
    });
  });
});
