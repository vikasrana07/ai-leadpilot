import { ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma, TxClient } from '@leadpilot/database';
import { NOTIFICATION_TYPES, type NotificationType } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';
import { RealtimeService } from '../realtime/realtime.module.js';
import { WebPushService } from './web-push.service.js';

export interface NotifyInput { tenantId: string; membershipIds: string[]; type: NotificationType; title: string; body?: string | undefined; link?: string | undefined; data?: Prisma.InputJsonObject }
export interface CreatedNotification { id: string; membershipId: string; type: string; title: string; body?: string | null; link?: string | null }

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(RealtimeService) private readonly rt: RealtimeService,
    @Optional() @Inject(WebPushService) private readonly webPush?: WebPushService,
  ) {}

  private requireMember(a: Actor): string { if (!a.membershipId) throw new ForbiddenException({ code: 'forbidden', message: 'Notifications are personal to a team member' }); return a.membershipId; }

  /** Creates notifications honouring each person's preferences. Call inside the caller's transaction, then `publish` after it commits. */
  async create(tx: TxClient, n: NotifyInput): Promise<CreatedNotification[]> {
    const ids = [...new Set(n.membershipIds)];
    if (ids.length === 0) return [];
    const active = await tx.membership.findMany({ where: { id: { in: ids }, tenantId: n.tenantId, status: 'ACTIVE' }, select: { id: true } });
    const prefs = await tx.notificationPreference.findMany({ where: { membershipId: { in: active.map((m) => m.id) }, type: n.type } });
    const muted = new Set(prefs.filter((p) => !p.inApp).map((p) => p.membershipId));
    const rows = active.filter((m) => !muted.has(m.id)).map((m) => ({ id: uuidv7(), tenantId: n.tenantId, membershipId: m.id, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, link: n.link ?? null, data: n.data ?? {} }));
    if (rows.length) await tx.notification.createMany({ data: rows });
    return rows.map((r) => ({ id: r.id, membershipId: r.membershipId, type: r.type, title: r.title, body: r.body, link: r.link }));
  }

  publish(tenantId: string, created: CreatedNotification[]): void {
    for (const c of created) this.rt.publish(tenantId, { type: 'notification.created', conversationId: '', assignedMembershipId: null, membershipId: c.membershipId, data: { id: c.id, type: c.type, title: c.title, body: c.body ?? null, link: c.link ?? null } });
    if (this.webPush && created.length > 0) void this.webPush.sendToMemberships(tenantId, created);
  }

  private tx<T>(a: Actor, fn: (tx: TxClient) => Promise<T>): Promise<T> { return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, fn); }

  async list(a: Actor, q: { unread?: 'true' | 'false' | undefined; limit: number; before?: string | undefined }) {
    const membershipId = this.requireMember(a);
    return this.tx(a, async (tx) => {
      const rows = await tx.notification.findMany({ where: { membershipId, ...(q.unread === 'true' ? { readAt: null } : {}), ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) }, orderBy: { createdAt: 'desc' }, take: q.limit });
      const unread = await tx.notification.count({ where: { membershipId, readAt: null } });
      return { unread, items: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, read: r.readAt !== null, createdAt: r.createdAt.toISOString() })) };
    });
  }

  async unreadCount(a: Actor): Promise<{ unread: number }> { const membershipId = this.requireMember(a); return this.tx(a, async (tx) => ({ unread: await tx.notification.count({ where: { membershipId, readAt: null } }) })); }

  async markRead(a: Actor, id: string): Promise<void> {
    const membershipId = this.requireMember(a);
    await this.tx(a, async (tx) => {
      const r = await tx.notification.updateMany({ where: { id, membershipId, readAt: null }, data: { readAt: new Date() } });
      if (r.count === 0 && !(await tx.notification.findFirst({ where: { id, membershipId }, select: { id: true } }))) throw new NotFoundException({ code: 'not_found', message: 'Notification not found' });
    });
  }

  async markAllRead(a: Actor): Promise<void> { const membershipId = this.requireMember(a); await this.tx(a, (tx) => tx.notification.updateMany({ where: { membershipId, readAt: null }, data: { readAt: new Date() } })); }

  async preferences(a: Actor) {
    const membershipId = this.requireMember(a);
    return this.tx(a, async (tx) => {
      const rows = await tx.notificationPreference.findMany({ where: { membershipId } });
      const m = new Map(rows.map((r) => [r.type, r.inApp]));
      return { preferences: NOTIFICATION_TYPES.map((type) => ({ type, inApp: m.get(type) ?? true })) };
    });
  }

  async setPreferences(a: Actor, prefs: { type: NotificationType; inApp: boolean }[]) {
    const membershipId = this.requireMember(a);
    await this.tx(a, async (tx) => { for (const p of prefs) await tx.notificationPreference.upsert({ where: { membershipId_type: { membershipId, type: p.type } }, create: { tenantId: a.tenantId, membershipId, type: p.type, inApp: p.inApp }, update: { inApp: p.inApp } }); });
    return this.preferences(a);
  }
}
