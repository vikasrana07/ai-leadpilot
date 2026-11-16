import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@leadpilot/validation';
import { DbService } from '../db/db.module.js';
import { MailService } from '../mail/mail.module.js';
import { NotificationsService, type CreatedNotification } from './notifications.service.js';

export interface OwnerNotice { type: Extract<NotificationType, 'billing' | 'quota' | 'privacy' | 'integration' | 'security'>; title: string; body?: string; link?: string; email?: { subject: string; text: string } }

/** Tells a workspace's owners about billing and quota events: in-app always (respecting their mute preferences), email for the serious ones. */
@Injectable()
export class BillingNotifier {
  private readonly log = new Logger('BillingNotifier');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(NotificationsService) private readonly notifications: NotificationsService, @Inject(MailService) private readonly mail: MailService) {}

  /** `onceKey` makes the notice exactly-once (e.g. "quota ai 80% in 2026-11"): the first caller wins the event mark. Returns whether anything was sent. */
  async notifyOwners(tenantId: string, n: OwnerNotice, onceKey?: string): Promise<boolean> {
    let created: CreatedNotification[] = [];
    let emails: string[] = [];
    const sent = await this.db.tenantTx({ tenantId }, async (tx) => {
      if (onceKey && (await tx.eventMark.createMany({ data: [{ tenantId, key: onceKey }], skipDuplicates: true })).count !== 1) return false;
      const owners = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'owner' } }, select: { id: true, userId: true } });
      created = await this.notifications.create(tx, { tenantId, membershipIds: owners.map((o) => o.id), type: n.type, title: n.title, body: n.body, link: n.link ?? '/billing' });
      if (n.email) emails = (await tx.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } }, select: { email: true } })).map((u) => u.email);
      return true;
    });
    if (!sent) return false;
    this.notifications.publish(tenantId, created);
    if (n.email) for (const to of emails) await this.mail.sendBilling(to, n.email.subject, n.email.text).catch((e: unknown) => this.log.error(`billing email failed: ${e instanceof Error ? e.message : String(e)}`));
    return true;
  }
}
