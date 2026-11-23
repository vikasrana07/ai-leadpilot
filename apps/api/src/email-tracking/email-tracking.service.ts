import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  EmailSuppressionCreateInput,
  EmailSuppressionListQuery,
  SendTrackedEmailInput,
  SnsMessageInput,
  TrackedEmailListQuery,
} from '@leadpilot/validation';
import type {
  EmailEngagementStatsDto,
  EmailSuppressionDto,
  TrackedEmailDetailDto,
  TrackedEmailDto,
} from '@leadpilot/shared-types';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { MailService } from '../mail/mail.module.js';
import { v7 as uuidv7 } from 'uuid';
import {
  validateSnsSubscribeUrl,
  verifySnsSignature,
} from './sns-validator.js';

interface OpenTokenPayload {
  e: string; // emailId
  t: string; // tenantId
  type: 'open';
}

interface ClickTokenPayload {
  e: string; // emailId
  t: string; // tenantId
  u: string; // original target url
  type: 'click';
}

/** Row-level scope for reads by members without `email:read:all`. */
export interface EmailReadScope { membershipId: string }

@Injectable()
export class EmailTrackingService {
  private readonly log = new Logger('EmailTracking');

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private get secret(): string {
    return this.env.TRACKING_SECRET || this.env.JWT_ACCESS_SECRET || 'leadpilot-default-tracking-hmac-key-2026';
  }

  private get baseUrl(): string {
    return (this.env.TRACKING_BASE_URL || this.env.WEB_ORIGIN || 'http://localhost:4000').replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------------------
  // Token Signing & Verification
  // ---------------------------------------------------------------------------

  signToken(payload: object): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  verifyToken<T>(token: string): T {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException({ code: 'invalid_token', message: 'Malformed tracking token' });
    }
    const [data, sig] = parts;
    const expectedSig = createHmac('sha256', this.secret).update(data).digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      throw new BadRequestException({ code: 'invalid_signature', message: 'Invalid or forged tracking token' });
    }

    try {
      return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T;
    } catch {
      throw new BadRequestException({ code: 'invalid_payload', message: 'Invalid token payload' });
    }
  }

  // ---------------------------------------------------------------------------
  // Outbound Email Tracking & HTML Instrumentation
  // ---------------------------------------------------------------------------

  private instrumentHtml(emailId: string, tenantId: string, rawHtml: string): string {
    const openToken = this.signToken({ e: emailId, t: tenantId, type: 'open' } satisfies OpenTokenPayload);
    const pixelUrl = `${this.baseUrl}/track/open/${openToken}`;
    const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0" />`;

    // Wrap href links for click tracking (excluding mailto, tel, anchors, and tracking urls)
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(https?:\/\/[^"'>\s]+)\1([^>]*)>/gi;
    let wrapped = rawHtml.replace(linkRegex, (match, quote, url, rest) => {
      if (url.startsWith(`${this.baseUrl}/track/`)) return match;
      const clickToken = this.signToken({ e: emailId, t: tenantId, u: url, type: 'click' } satisfies ClickTokenPayload);
      const clickUrl = `${this.baseUrl}/track/click/${clickToken}`;
      return `<a href="${clickUrl}"${rest}>`;
    });

    if (wrapped.includes('</body>')) {
      wrapped = wrapped.replace('</body>', `${pixelTag}</body>`);
    } else {
      wrapped += pixelTag;
    }

    return wrapped;
  }

  async sendTrackedEmail(
    actor: { tenantId: string; userId: string },
    input: SendTrackedEmailInput,
  ): Promise<{ id: string; status: string; suppressed?: boolean; messageId?: string | null }> {
    const normEmail = input.to.trim().toLowerCase();

    // 1. Check suppression list before attempting send
    const suppressed = await this.db.tenantTx({ tenantId: actor.tenantId }, (tx) =>
      tx.emailSuppression.findUnique({
        where: { tenantId_email: { tenantId: actor.tenantId, email: normEmail } },
      }),
    );

    if (suppressed) {
      const id = uuidv7();
      await this.db.tenantTx({ tenantId: actor.tenantId }, async (tx) => {
        await tx.trackedEmail.create({
          data: {
            id,
            tenantId: actor.tenantId,
            leadId: input.leadId ?? null,
            recipient: normEmail,
            subject: input.subject,
            status: 'SUPPRESSED',
            metadata: { suppressionReason: suppressed.reason, notes: suppressed.notes },
          },
        });

        if (input.leadId) {
          await tx.leadActivity.create({
            data: {
              id: uuidv7(),
              tenantId: actor.tenantId,
              leadId: input.leadId,
              type: 'email_bounced',
              actorUserId: actor.userId,
              data: {
                subject: input.subject,
                recipient: normEmail,
                reason: `Recipient suppressed (${suppressed.reason})`,
              },
            },
          });
        }
      });

      return { id, status: 'SUPPRESSED', suppressed: true };
    }

    // 2. Prepare email content & instrumentation
    const emailId = uuidv7();
    const rawHtml = input.html
      ? input.html
      : `<p>${input.text.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br />')}</p>`;

    const instrumentedHtml = this.instrumentHtml(emailId, actor.tenantId, rawHtml);

    const headers: Record<string, string> = {
      'X-LeadPilot-Email-Id': emailId,
      'X-LeadPilot-Tenant-Id': actor.tenantId,
      'X-SES-MESSAGE-TAGS': `tenantId=${actor.tenantId},emailId=${emailId}`,
    };
    if (this.env.SES_CONFIGURATION_SET) {
      headers['X-SES-CONFIGURATION-SET'] = this.env.SES_CONFIGURATION_SET;
    }

    // 3. Dispatch via Mailer
    let messageId: string | null = null;
    try {
      const res = await this.mail.sendCustom({
        to: normEmail,
        subject: input.subject,
        text: input.text,
        html: instrumentedHtml,
        headers,
      });
      messageId = res.messageId;
    } catch (err) {
      this.log.error(`Failed to dispatch tracked email: ${err instanceof Error ? err.message : String(err)}`);
      await this.db.tenantTx({ tenantId: actor.tenantId }, (tx) =>
        tx.trackedEmail.create({
          data: {
            id: emailId,
            tenantId: actor.tenantId,
            leadId: input.leadId ?? null,
            recipient: normEmail,
            subject: input.subject,
            status: 'FAILED',
            metadata: { error: err instanceof Error ? err.message : String(err) },
          },
        }),
      );
      throw err;
    }

    // 4. Save TrackedEmail record & LeadActivity
    await this.db.tenantTx({ tenantId: actor.tenantId }, async (tx) => {
      await tx.trackedEmail.create({
        data: {
          id: emailId,
          tenantId: actor.tenantId,
          leadId: input.leadId ?? null,
          recipient: normEmail,
          subject: input.subject,
          status: 'SENT',
          sesMessageId: messageId,
          smtpMessageId: messageId,
          metadata: { tags: input.tags ?? {} },
        },
      });

      if (input.leadId) {
        await tx.leadActivity.create({
          data: {
            id: uuidv7(),
            tenantId: actor.tenantId,
            leadId: input.leadId,
            type: 'email_sent',
            actorUserId: actor.userId,
            data: {
              emailId,
              subject: input.subject,
              recipient: normEmail,
              messageId,
            },
          },
        });
      }
    });

    return { id: emailId, status: 'SENT', messageId };
  }

  // ---------------------------------------------------------------------------
  // Native Open & Click Web Endpoints
  // ---------------------------------------------------------------------------

  async recordOpenToken(
    tokenStr: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const payload = this.verifyToken<OpenTokenPayload>(tokenStr);
    if (payload.type !== 'open' || !payload.e || !payload.t) {
      throw new BadRequestException('Invalid open token payload');
    }

    await this.db.tenantTx({ tenantId: payload.t }, async (tx) => {
      const email = await tx.trackedEmail.findFirst({
        where: { id: payload.e, tenantId: payload.t },
      });
      if (!email) return;

      const now = new Date();
      await tx.trackedEmail.update({
        where: { id: email.id },
        data: {
          openCount: { increment: 1 },
          firstOpenedAt: email.firstOpenedAt ?? now,
          lastOpenedAt: now,
          status: email.status === 'CLICKED' ? 'CLICKED' : 'OPENED',
        },
      });

      await tx.emailEngagementEvent.create({
        data: {
          id: uuidv7(),
          tenantId: payload.t,
          emailId: email.id,
          type: 'OPEN',
          timestamp: now,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      if (email.leadId) {
        await tx.leadActivity.create({
          data: {
            id: uuidv7(),
            tenantId: payload.t,
            leadId: email.leadId,
            type: 'email_opened',
            actorUserId: null,
            data: {
              emailId: email.id,
              subject: email.subject,
              openCount: email.openCount + 1,
            },
          },
        });
      }
    });
  }

  async recordClickToken(
    tokenStr: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<string> {
    const payload = this.verifyToken<ClickTokenPayload>(tokenStr);
    if (payload.type !== 'click' || !payload.e || !payload.t || !payload.u) {
      throw new BadRequestException('Invalid click token payload');
    }

    await this.db.tenantTx({ tenantId: payload.t }, async (tx) => {
      const email = await tx.trackedEmail.findFirst({
        where: { id: payload.e, tenantId: payload.t },
      });
      if (!email) return;

      const now = new Date();
      await tx.trackedEmail.update({
        where: { id: email.id },
        data: {
          clickCount: { increment: 1 },
          status: 'CLICKED',
        },
      });

      await tx.emailEngagementEvent.create({
        data: {
          id: uuidv7(),
          tenantId: payload.t,
          emailId: email.id,
          type: 'CLICK',
          timestamp: now,
          clickUrl: payload.u,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      if (email.leadId) {
        await tx.leadActivity.create({
          data: {
            id: uuidv7(),
            tenantId: payload.t,
            leadId: email.leadId,
            type: 'email_clicked',
            actorUserId: null,
            data: {
              emailId: email.id,
              subject: email.subject,
              url: payload.u,
            },
          },
        });
      }
    });

    return payload.u;
  }

  // ---------------------------------------------------------------------------
  // Amazon SNS / SES Webhook Ingestion
  // ---------------------------------------------------------------------------

  async handleSnsMessage(rawMessage: SnsMessageInput): Promise<{ status: string }> {
    const valid = await verifySnsSignature(rawMessage, this.env.SES_TRACKING_MODE);
    if (!valid) {
      throw new BadRequestException({ code: 'invalid_signature', message: 'AWS SNS signature verification failed' });
    }

    // Auto-confirm subscription
    if (rawMessage.Type === 'SubscriptionConfirmation') {
      if (!rawMessage.SubscribeURL) {
        throw new BadRequestException('SubscriptionConfirmation missing SubscribeURL');
      }
      const safeUrl = validateSnsSubscribeUrl(rawMessage.SubscribeURL);
      this.log.log(`Confirming SNS subscription for topic ${rawMessage.TopicArn}`);
      const res = await fetch(safeUrl.toString());
      if (!res.ok) {
        this.log.error(`Failed to confirm SNS subscription: HTTP ${res.status}`);
        throw new BadRequestException('Failed to confirm SNS subscription');
      }
      return { status: 'subscription_confirmed' };
    }

    if (rawMessage.Type !== 'Notification') {
      return { status: 'ignored' };
    }

    let sesPayload: Record<string, unknown>;
    try {
      sesPayload = JSON.parse(rawMessage.Message);
    } catch {
      throw new BadRequestException('Notification message contains invalid JSON');
    }

    const eventType = String(sesPayload.eventType ?? sesPayload.notificationType ?? '');
    const mail = (sesPayload.mail ?? {}) as {
      messageId?: string;
      headers?: Array<{ name: string; value: string }>;
      tags?: Record<string, string[] | string>;
    };

    const sesMessageId = mail.messageId;
    let emailId: string | null = null;

    if (mail.tags) {
      const tagEmail = mail.tags.emailId;
      if (typeof tagEmail === 'string') emailId = tagEmail;
      else if (Array.isArray(tagEmail) && tagEmail[0]) emailId = tagEmail[0];
    }

    if (!emailId && mail.headers) {
      for (const h of mail.headers) {
        if (h.name.toLowerCase() === 'x-leadpilot-email-id') emailId = h.value;
      }
    }

    // Locate the email in the database
    const trackedEmail = await this.db.userTx(null, async (tx) => {
      if (emailId) {
        return tx.trackedEmail.findUnique({ where: { id: emailId } });
      }
      if (sesMessageId) {
        return tx.trackedEmail.findFirst({
          where: {
            OR: [{ sesMessageId }, { smtpMessageId: sesMessageId }],
          },
        });
      }
      return null;
    });

    if (!trackedEmail) {
      this.log.warn(`Received SES ${eventType} notification for unmatched message ${sesMessageId}`);
      return { status: 'unmatched' };
    }

    await this.processSesEvent(trackedEmail.tenantId, trackedEmail.id, eventType, sesPayload);
    return { status: 'processed' };
  }

  private async processSesEvent(
    tenantId: string,
    emailId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const normalizedType = eventType.toUpperCase();

    await this.db.tenantTx({ tenantId }, async (tx) => {
      const email = await tx.trackedEmail.findFirst({ where: { id: emailId, tenantId } });
      if (!email) return;

      const now = new Date();

      switch (normalizedType) {
        case 'DELIVERY': {
          await tx.trackedEmail.update({
            where: { id: email.id },
            data: {
              status: email.status === 'OPENED' || email.status === 'CLICKED' ? email.status : 'DELIVERED',
              deliveredAt: email.deliveredAt ?? now,
            },
          });
          await tx.emailEngagementEvent.create({
            data: {
              id: uuidv7(),
              tenantId,
              emailId: email.id,
              type: 'DELIVERY',
              timestamp: now,
              metadata: (payload.delivery as object) ?? {},
            },
          });
          if (email.leadId) {
            await tx.leadActivity.create({
              data: {
                id: uuidv7(),
                tenantId,
                leadId: email.leadId,
                type: 'email_delivered',
                actorUserId: null,
                data: { emailId: email.id, subject: email.subject },
              },
            });
          }
          break;
        }

        case 'OPEN': {
          const openData = (payload.open ?? {}) as { ipAddress?: string; userAgent?: string };
          await tx.trackedEmail.update({
            where: { id: email.id },
            data: {
              openCount: { increment: 1 },
              firstOpenedAt: email.firstOpenedAt ?? now,
              lastOpenedAt: now,
              status: email.status === 'CLICKED' ? 'CLICKED' : 'OPENED',
            },
          });
          await tx.emailEngagementEvent.create({
            data: {
              id: uuidv7(),
              tenantId,
              emailId: email.id,
              type: 'OPEN',
              timestamp: now,
              ipAddress: openData.ipAddress ?? null,
              userAgent: openData.userAgent ?? null,
              metadata: (payload.open as object) ?? {},
            },
          });
          if (email.leadId) {
            await tx.leadActivity.create({
              data: {
                id: uuidv7(),
                tenantId,
                leadId: email.leadId,
                type: 'email_opened',
                actorUserId: null,
                data: { emailId: email.id, subject: email.subject, openCount: email.openCount + 1 },
              },
            });
          }
          break;
        }

        case 'CLICK': {
          const clickData = (payload.click ?? {}) as { ipAddress?: string; userAgent?: string; link?: string };
          await tx.trackedEmail.update({
            where: { id: email.id },
            data: {
              clickCount: { increment: 1 },
              status: 'CLICKED',
            },
          });
          await tx.emailEngagementEvent.create({
            data: {
              id: uuidv7(),
              tenantId,
              emailId: email.id,
              type: 'CLICK',
              timestamp: now,
              clickUrl: clickData.link ?? null,
              ipAddress: clickData.ipAddress ?? null,
              userAgent: clickData.userAgent ?? null,
              metadata: (payload.click as object) ?? {},
            },
          });
          if (email.leadId) {
            await tx.leadActivity.create({
              data: {
                id: uuidv7(),
                tenantId,
                leadId: email.leadId,
                type: 'email_clicked',
                actorUserId: null,
                data: { emailId: email.id, subject: email.subject, url: clickData.link ?? null },
              },
            });
          }
          break;
        }

        case 'BOUNCE': {
          const bounce = (payload.bounce ?? {}) as {
            bounceType?: string;
            bounceSubType?: string;
            bouncedRecipients?: Array<{ emailAddress: string; diagnosticCode?: string }>;
          };
          const bType = bounce.bounceType ?? 'Undetermined';
          const bSubType = bounce.bounceSubType ?? 'General';

          await tx.trackedEmail.update({
            where: { id: email.id },
            data: {
              status: 'BOUNCED',
              bouncedAt: now,
              bounceType: bType,
              bounceSubType: bSubType,
            },
          });
          await tx.emailEngagementEvent.create({
            data: {
              id: uuidv7(),
              tenantId,
              emailId: email.id,
              type: 'BOUNCE',
              timestamp: now,
              metadata: (payload.bounce as object) ?? {},
            },
          });

          if (email.leadId) {
            await tx.leadActivity.create({
              data: {
                id: uuidv7(),
                tenantId,
                leadId: email.leadId,
                type: 'email_bounced',
                actorUserId: null,
                data: {
                  emailId: email.id,
                  subject: email.subject,
                  bounceType: bType,
                  bounceSubType: bSubType,
                },
              },
            });
          }

          // Hard Bounce: Add recipient to suppression list immediately
          if (bType.toLowerCase() === 'permanent') {
            await tx.emailSuppression.upsert({
              where: { tenantId_email: { tenantId, email: email.recipient } },
              create: {
                id: uuidv7(),
                tenantId,
                email: email.recipient,
                reason: 'HARD_BOUNCE',
                source: `ses_bounce_${bSubType}`,
                notes: bounce.bouncedRecipients?.[0]?.diagnosticCode ?? 'Permanent SES bounce',
              },
              update: {
                reason: 'HARD_BOUNCE',
                notes: bounce.bouncedRecipients?.[0]?.diagnosticCode ?? 'Permanent SES bounce',
              },
            });
            this.log.warn(`Suppressed permanently bounced recipient: ${email.recipient}`);
          }
          break;
        }

        case 'COMPLAINT': {
          const complaint = (payload.complaint ?? {}) as {
            complaintFeedbackType?: string;
          };
          await tx.trackedEmail.update({
            where: { id: email.id },
            data: {
              status: 'COMPLAINED',
              complaintAt: now,
              complaintFeedbackType: complaint.complaintFeedbackType ?? null,
            },
          });
          await tx.emailEngagementEvent.create({
            data: {
              id: uuidv7(),
              tenantId,
              emailId: email.id,
              type: 'COMPLAINT',
              timestamp: now,
              metadata: (payload.complaint as object) ?? {},
            },
          });

          if (email.leadId) {
            await tx.leadActivity.create({
              data: {
                id: uuidv7(),
                tenantId,
                leadId: email.leadId,
                type: 'email_complained',
                actorUserId: null,
                data: {
                  emailId: email.id,
                  subject: email.subject,
                  feedbackType: complaint.complaintFeedbackType ?? null,
                },
              },
            });
          }

          // Spam complaint: Add recipient to suppression list immediately
          await tx.emailSuppression.upsert({
            where: { tenantId_email: { tenantId, email: email.recipient } },
            create: {
              id: uuidv7(),
              tenantId,
              email: email.recipient,
              reason: 'COMPLAINT',
              source: 'ses_complaint',
              notes: `Spam complaint (${complaint.complaintFeedbackType ?? 'unspecified'})`,
            },
            update: {
              reason: 'COMPLAINT',
              notes: `Spam complaint (${complaint.complaintFeedbackType ?? 'unspecified'})`,
            },
          });
          this.log.warn(`Suppressed complained recipient: ${email.recipient}`);
          break;
        }

        case 'REJECT': {
          await tx.trackedEmail.update({
            where: { id: email.id },
            data: { status: 'REJECTED' },
          });
          await tx.emailEngagementEvent.create({
            data: {
              id: uuidv7(),
              tenantId,
              emailId: email.id,
              type: 'REJECT',
              timestamp: now,
              metadata: (payload.reject as object) ?? {},
            },
          });
          break;
        }

        default:
          this.log.debug(`Unhandled SES event type: ${eventType}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Queries & Management
  // ---------------------------------------------------------------------------

  /** `{ membershipId }` restricts reads to emails about leads assigned to that member; `undefined` = whole workspace (`email:read:all`). */
  private leadScope(scope?: EmailReadScope): Record<string, unknown> {
    return scope ? { lead: { is: { assignedMembershipId: scope.membershipId } } } : {};
  }

  /**
   * Sending authority: an agent may email a lead they may edit (`lead:write:own` + assigned, or `lead:write:all`). Emailing an arbitrary
   * address with no lead requires `lead:write:all`, so the workspace's mail domain is not an open relay for every member.
   */
  async assertCanEmail(actor: { tenantId: string; membershipId: string | null; permissions: ReadonlySet<string> }, leadId?: string): Promise<void> {
    const all = actor.permissions.has('lead:write:all');
    if (!leadId) {
      if (!all) throw new ForbiddenException({ code: 'forbidden', message: 'Open a lead to email it' });
      return;
    }
    const lead = await this.db.tenantTx({ tenantId: actor.tenantId }, (tx) =>
      tx.lead.findFirst({ where: { id: leadId, tenantId: actor.tenantId }, select: { assignedMembershipId: true } }),
    );
    if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
    if (!all && !(actor.permissions.has('lead:write:own') && actor.membershipId !== null && lead.assignedMembershipId === actor.membershipId)) {
      throw new NotFoundException({ code: 'not_found', message: 'Lead not found' }); // do not reveal other members' leads
    }
  }

  async getStats(tenantId: string, scope?: EmailReadScope): Promise<EmailEngagementStatsDto> {
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const counts = await tx.trackedEmail.groupBy({
        by: ['status'],
        where: { tenantId, ...this.leadScope(scope) },
        _count: { _all: true },
      });

      const map = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
      const totalSent = (map.SENT ?? 0) + (map.DELIVERED ?? 0) + (map.OPENED ?? 0) + (map.CLICKED ?? 0) + (map.BOUNCED ?? 0) + (map.COMPLAINED ?? 0);
      const delivered = (map.DELIVERED ?? 0) + (map.OPENED ?? 0) + (map.CLICKED ?? 0);
      const opened = (map.OPENED ?? 0) + (map.CLICKED ?? 0);
      const clicked = map.CLICKED ?? 0;
      const bounced = map.BOUNCED ?? 0;
      const complained = map.COMPLAINED ?? 0;
      const suppressed = map.SUPPRESSED ?? 0;

      const deliveryRatePercent = totalSent > 0 ? Number(((delivered / totalSent) * 100).toFixed(1)) : 100;
      const openRatePercent = delivered > 0 ? Number(((opened / delivered) * 100).toFixed(1)) : 0;
      const clickRatePercent = opened > 0 ? Number(((clicked / opened) * 100).toFixed(1)) : 0;
      const bounceRatePercent = totalSent > 0 ? Number(((bounced / totalSent) * 100).toFixed(1)) : 0;

      return {
        totalSent,
        delivered,
        opened,
        clicked,
        bounced,
        complained,
        suppressed,
        deliveryRatePercent,
        openRatePercent,
        clickRatePercent,
        bounceRatePercent,
      };
    });
  }

  async listTrackedEmails(
    tenantId: string,
    query: TrackedEmailListQuery,
    scope?: EmailReadScope,
  ): Promise<{ items: TrackedEmailDto[]; total: number; page: number; limit: number }> {
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const where: Record<string, unknown> = { tenantId, ...this.leadScope(scope) };
      if (query.status) where.status = query.status;
      if (query.leadId) where.leadId = query.leadId;
      if (query.q) {
        where.OR = [
          { recipient: { contains: query.q, mode: 'insensitive' } },
          { subject: { contains: query.q, mode: 'insensitive' } },
        ];
      }

      const [rows, total] = await Promise.all([
        tx.trackedEmail.findMany({
          where,
          include: { lead: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.trackedEmail.count({ where }),
      ]);

      const items: TrackedEmailDto[] = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        leadId: r.leadId,
        leadName: r.lead?.name ?? null,
        recipient: r.recipient,
        subject: r.subject,
        status: r.status,
        sesMessageId: r.sesMessageId,
        smtpMessageId: r.smtpMessageId,
        openCount: r.openCount,
        clickCount: r.clickCount,
        firstOpenedAt: r.firstOpenedAt?.toISOString() ?? null,
        lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        bouncedAt: r.bouncedAt?.toISOString() ?? null,
        bounceType: r.bounceType,
        bounceSubType: r.bounceSubType,
        complaintAt: r.complaintAt?.toISOString() ?? null,
        complaintFeedbackType: r.complaintFeedbackType,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));

      return { items, total, page: query.page, limit: query.limit };
    });
  }

  async getEmailDetail(tenantId: string, id: string, scope?: EmailReadScope): Promise<TrackedEmailDetailDto> {
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const r = await tx.trackedEmail.findFirst({
        where: { id, tenantId, ...this.leadScope(scope) },
        include: {
          lead: { select: { id: true, name: true } },
          events: { orderBy: { timestamp: 'asc' } },
        },
      });

      if (!r) {
        throw new NotFoundException({ code: 'not_found', message: 'Tracked email not found' });
      }

      return {
        id: r.id,
        tenantId: r.tenantId,
        leadId: r.leadId,
        leadName: r.lead?.name ?? null,
        recipient: r.recipient,
        subject: r.subject,
        status: r.status,
        sesMessageId: r.sesMessageId,
        smtpMessageId: r.smtpMessageId,
        openCount: r.openCount,
        clickCount: r.clickCount,
        firstOpenedAt: r.firstOpenedAt?.toISOString() ?? null,
        lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        bouncedAt: r.bouncedAt?.toISOString() ?? null,
        bounceType: r.bounceType,
        bounceSubType: r.bounceSubType,
        complaintAt: r.complaintAt?.toISOString() ?? null,
        complaintFeedbackType: r.complaintFeedbackType,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        events: r.events.map((e) => ({
          id: e.id,
          type: e.type,
          timestamp: e.timestamp.toISOString(),
          ipAddress: e.ipAddress,
          userAgent: e.userAgent,
          clickUrl: e.clickUrl,
          metadata: (e.metadata as Record<string, unknown>) ?? {},
        })),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Suppression List CRUD
  // ---------------------------------------------------------------------------

  async listSuppressions(
    tenantId: string,
    query: EmailSuppressionListQuery,
  ): Promise<{ items: EmailSuppressionDto[]; total: number; page: number; limit: number }> {
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const where: Record<string, unknown> = { tenantId };
      if (query.reason) where.reason = query.reason;
      if (query.q) {
        where.email = { contains: query.q.toLowerCase(), mode: 'insensitive' };
      }

      const [rows, total] = await Promise.all([
        tx.emailSuppression.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.emailSuppression.count({ where }),
      ]);

      return {
        items: rows.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          email: r.email,
          reason: r.reason,
          source: r.source,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async addSuppression(
    tenantId: string,
    input: EmailSuppressionCreateInput,
  ): Promise<EmailSuppressionDto> {
    return this.db.tenantTx({ tenantId }, async (tx) => {
      const norm = input.email.trim().toLowerCase();
      const existing = await tx.emailSuppression.findUnique({
        where: { tenantId_email: { tenantId, email: norm } },
      });
      if (existing) {
        throw new ConflictException({ code: 'already_suppressed', message: 'Email is already on the suppression list' });
      }

      const row = await tx.emailSuppression.create({
        data: {
          id: uuidv7(),
          tenantId,
          email: norm,
          reason: input.reason,
          source: 'manual_agent',
          notes: input.notes ?? null,
        },
      });

      return {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        reason: row.reason,
        source: row.source,
        notes: row.notes,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async removeSuppression(tenantId: string, id: string): Promise<void> {
    await this.db.tenantTx({ tenantId }, async (tx) => {
      const existing = await tx.emailSuppression.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw new NotFoundException({ code: 'not_found', message: 'Suppressed email record not found' });
      }
      await tx.emailSuppression.delete({ where: { id } });
    });
  }
}
