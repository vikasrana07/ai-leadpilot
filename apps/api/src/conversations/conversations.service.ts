import { EntitlementsService, paymentRequired } from '../billing/entitlements.service.js';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type TxClient } from '@leadpilot/database';
import type { z } from 'zod';
import type { conversationListSchema, sendMessageSchema } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';
import { ChannelsService } from '../channels/channels.module.js';
import { RealtimeService } from '../realtime/realtime.module.js';
import { WHATSAPP_CLIENT, WhatsAppApiError, type WhatsAppClient } from '../whatsapp/whatsapp.client.js';

type ListQuery = z.infer<typeof conversationListSchema>;
type SendInput = z.infer<typeof sendMessageSchema>;
export const WINDOW_MS = 24 * 3600 * 1000;

@Injectable()
export class ConversationsService {
  private readonly log = new Logger('Conversations');
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(RealtimeService) private readonly rt: RealtimeService,
    @Inject(WHATSAPP_CLIENT) private readonly wa: WhatsAppClient,
    @Inject(EntitlementsService) private readonly ent: EntitlementsService,
  ) {}

  private tx<T>(a: Actor, fn: (tx: TxClient) => Promise<T>): Promise<T> { return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, fn); }

  /** `conversation:read:all` sees every conversation; `conversation:read:own` only those assigned to the caller. */
  scope(a: Actor): Prisma.ConversationWhereInput {
    if (a.permissions.has('conversation:read:all')) return {};
    if (a.permissions.has('conversation:read:own') && a.membershipId) return { assignedMembershipId: a.membershipId };
    throw new ForbiddenException({ code: 'forbidden', message: 'You do not have permission to view conversations' });
  }

  private async mustFind(tx: TxClient, a: Actor, id: string) {
    const c = await tx.conversation.findFirst({ where: { id, tenantId: a.tenantId, ...this.scope(a) }, include: { channel: { select: { id: true, type: true, name: true, status: true } } } });
    if (!c) throw new NotFoundException({ code: 'not_found', message: 'Conversation not found' });
    return c;
  }

  private rec(tx: TxClient, a: Actor, action: string, id: string, metadata: Prisma.InputJsonObject = {}) {
    return this.audit.record(tx, { tenantId: a.tenantId, actorUserId: a.userId, action, resourceType: 'conversation', resourceId: id, metadata, ...(a.requestId ? { requestId: a.requestId } : {}), ...(a.ip ? { ip: a.ip } : {}) });
  }

  private notify(a: Actor, id: string, assigned: string | null, type: 'conversation.updated' | 'message.created' = 'conversation.updated', data?: Record<string, string>) {
    this.rt.publish(a.tenantId, { type, conversationId: id, assignedMembershipId: assigned, ...(data ? { data } : {}) });
  }

  private windowInfo(c: { channel: { type: string }; lastInboundAt: Date | null }, now = Date.now()) {
    if (c.channel.type !== 'WHATSAPP') return { windowOpen: true, windowExpiresAt: null as string | null };
    const exp = c.lastInboundAt ? c.lastInboundAt.getTime() + WINDOW_MS : 0;
    return { windowOpen: exp > now, windowExpiresAt: exp ? new Date(exp).toISOString() : null };
  }

  // ------------------------------------------------------------------ reads
  async list(a: Actor, q: ListQuery) {
    return this.tx(a, async (tx) => {
      const and: Prisma.ConversationWhereInput[] = [{ tenantId: a.tenantId }, this.scope(a)];
      if (q.status) and.push({ status: q.status });
      if (q.mode) and.push({ mode: q.mode });
      if (q.channelType) and.push({ channel: { type: q.channelType } });
      if (q.unread === 'true') and.push({ unreadCount: { gt: 0 } });
      if (q.assigned === 'unassigned') and.push({ assignedMembershipId: null });
      else if (q.assigned === 'me') and.push({ assignedMembershipId: a.membershipId ?? '00000000-0000-0000-0000-000000000000' });
      else if (q.assigned) and.push({ assignedMembershipId: q.assigned });
      if (q.q) {
        const digits = q.q.replace(/\D/g, '');
        const leads = await tx.lead.findMany({ where: { tenantId: a.tenantId, OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, ...(digits.length >= 3 ? [{ phoneNorm: { contains: digits } }] : [])] }, select: { id: true }, take: 200 });
        and.push({ leadId: { in: leads.map((l) => l.id) } });
      }
      const where = { AND: and };
      const [total, rows, unreadTotal] = await Promise.all([
        tx.conversation.count({ where }),
        tx.conversation.findMany({ where, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { channel: { select: { id: true, type: true, name: true } } } }),
        tx.conversation.count({ where: { AND: [{ tenantId: a.tenantId }, this.scope(a), { unreadCount: { gt: 0 } }, { status: 'OPEN' }] } }),
      ]);
      const leads = await tx.lead.findMany({ where: { id: { in: rows.map((r) => r.leadId) } }, select: { id: true, name: true, phone: true, email: true, score: true, temperature: true } });
      const byLead = new Map(leads.map((l) => [l.id, l]));
      const names = await this.assigneeNames(tx, rows.map((r) => r.assignedMembershipId));
      return {
        total, page: q.page, pageSize: q.pageSize, unreadTotal,
        items: rows.map((c) => ({ id: c.id, status: c.status, mode: c.mode, channel: c.channel, lead: byLead.get(c.leadId) ?? null, assignee: c.assignedMembershipId ? { id: c.assignedMembershipId, name: names.get(c.assignedMembershipId) ?? 'Unknown' } : null, lastMessageAt: c.lastMessageAt.toISOString(), preview: c.lastMessagePreview, unreadCount: c.unreadCount, tags: c.tags, ...this.windowInfo(c) })),
      };
    });
  }

  private async assigneeNames(tx: TxClient, ids: (string | null)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => x !== null))];
    if (!uniq.length) return new Map<string, string>();
    const ms = await tx.membership.findMany({ where: { id: { in: uniq } }, select: { id: true, userId: true } });
    const us = await tx.user.findMany({ where: { id: { in: ms.map((m) => m.userId) } }, select: { id: true, name: true } });
    return new Map(ms.map((m) => [m.id, us.find((u) => u.id === m.userId)?.name ?? 'Unknown']));
  }

  async get(a: Actor, id: string) {
    return this.tx(a, async (tx) => {
      const c = await this.mustFind(tx, a, id);
      const lead = await tx.lead.findUnique({ where: { id: c.leadId }, include: { stage: { select: { name: true, kind: true } }, source: { select: { name: true } } } });
      const names = await this.assigneeNames(tx, [c.assignedMembershipId, lead?.assignedMembershipId ?? null]);
      const consent = await tx.consent.findFirst({ where: { leadId: c.leadId, channel: 'whatsapp' }, orderBy: { createdAt: 'desc' } });
      const appts = 0;
      return {
        id: c.id, status: c.status, mode: c.mode, channel: c.channel, tags: c.tags, unreadCount: c.unreadCount, ...this.windowInfo(c), appointments: appts,
        assignee: c.assignedMembershipId ? { id: c.assignedMembershipId, name: names.get(c.assignedMembershipId) ?? 'Unknown' } : null,
        whatsappConsent: consent?.status ?? null,
        lead: lead ? { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, stage: lead.stage, source: lead.source?.name ?? null, temperature: lead.temperature, score: lead.score, budgetMin: lead.budgetMinMinor === null ? null : Number(lead.budgetMinMinor) / 100, budgetMax: lead.budgetMaxMinor === null ? null : Number(lead.budgetMaxMinor) / 100, location: lead.location, propertyType: lead.propertyType, buyingTimeline: lead.buyingTimeline, assignee: lead.assignedMembershipId ? { id: lead.assignedMembershipId, name: names.get(lead.assignedMembershipId) ?? 'Unknown' } : null } : null,
      };
    });
  }

  async messages(a: Actor, id: string, before?: string, limit = 50) {
    return this.tx(a, async (tx) => {
      await this.mustFind(tx, a, id);
      const cursor = before ? await tx.message.findFirst({ where: { id: before, conversationId: id }, select: { createdAt: true } }) : null;
      const rows = await tx.message.findMany({ where: { conversationId: id, ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: Math.min(limit, 100) + 1 });
      const more = rows.length > Math.min(limit, 100);
      const page = (more ? rows.slice(0, -1) : rows).reverse();
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(page.map((m) => m.senderUserId).filter((x): x is string => x !== null))] } }, select: { id: true, name: true } });
      const uname = new Map(users.map((u) => [u.id, u.name]));
      return { hasMore: more, items: page.map((m) => ({ id: m.id, direction: m.direction, senderType: m.senderType, sender: m.senderUserId ? uname.get(m.senderUserId) ?? null : null, type: m.type, body: m.body, media: m.media ? { ...(m.media as object) } : null, template: m.template, status: m.status, error: m.error, createdAt: m.createdAt.toISOString() })) };
    });
  }

  // ------------------------------------------------------------------ actions
  async markRead(a: Actor, id: string): Promise<void> {
    const assigned = await this.tx(a, async (tx) => { const c = await this.mustFind(tx, a, id); if (c.unreadCount > 0) await tx.conversation.update({ where: { id }, data: { unreadCount: 0 } }); return c.assignedMembershipId; });
    this.notify(a, id, assigned);
  }

  async assign(a: Actor, id: string, membershipId: string | null) {
    if (!a.permissions.has('conversation:assign')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot assign conversations' });
    const assigned = await this.tx(a, async (tx) => {
      await this.mustFind(tx, a, id);
      if (membershipId && !(await tx.membership.findFirst({ where: { id: membershipId, tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true } }))) throw new BadRequestException({ code: 'invalid_assignee', message: 'That team member is not available' });
      await tx.conversation.update({ where: { id }, data: { assignedMembershipId: membershipId } });
      await this.rec(tx, a, 'conversation.assigned', id, { to: membershipId });
      return membershipId;
    });
    this.notify(a, id, assigned);
  }

  private async setStatus(a: Actor, id: string, status: 'OPEN' | 'CLOSED'): Promise<void> {
    this.requireReply(a);
    const assigned = await this.tx(a, async (tx) => {
      const c = await this.mustFind(tx, a, id);
      await tx.conversation.update({ where: { id }, data: { status, closedAt: status === 'CLOSED' ? new Date() : null } });
      await this.rec(tx, a, status === 'CLOSED' ? 'conversation.closed' : 'conversation.reopened', id);
      return c.assignedMembershipId;
    });
    this.notify(a, id, assigned);
  }
  close(a: Actor, id: string) { return this.setStatus(a, id, 'CLOSED'); }
  reopen(a: Actor, id: string) { return this.setStatus(a, id, 'OPEN'); }

  private requireReply(a: Actor): void { if (!a.permissions.has('conversation:reply')) throw new ForbiddenException({ code: 'forbidden', message: 'You cannot reply to conversations' }); }

  /** A human joins: the AI stops replying. If nobody owns the conversation it is assigned to the person joining. */
  async takeover(a: Actor, id: string) {
    this.requireReply(a);
    const assigned = await this.tx(a, async (tx) => {
      const c = await this.mustFind(tx, a, id);
      const owner = c.assignedMembershipId ?? a.membershipId;
      await tx.conversation.update({ where: { id }, data: { mode: 'HUMAN', assignedMembershipId: owner } });
      await tx.message.create({ data: { id: uuidv7(), tenantId: a.tenantId, conversationId: id, channelId: c.channelId, direction: 'OUTBOUND', senderType: 'SYSTEM', type: 'TEXT', body: 'A team member joined the conversation', status: 'DELIVERED' } });
      await this.rec(tx, a, 'conversation.takeover', id);
      return owner;
    });
    this.notify(a, id, assigned);
  }

  async handback(a: Actor, id: string) {
    this.requireReply(a);
    const assigned = await this.tx(a, async (tx) => {
      const c = await this.mustFind(tx, a, id);
      const ai = await tx.aiAssistant.findUnique({ where: { tenantId: a.tenantId }, select: { enabled: true } });
      if (!ai?.enabled) throw new ConflictException({ code: 'ai_not_configured', message: 'The AI assistant is switched off, so there is nothing to hand this conversation back to. Turn it on in AI Assistant settings.' });
      await tx.conversation.update({ where: { id }, data: { mode: 'AI' } });
      await this.rec(tx, a, 'conversation.handback', id);
      return c.assignedMembershipId;
    });
    this.notify(a, id, assigned);
  }

  async addNote(a: Actor, id: string, body: string) {
    this.requireReply(a);
    if (!a.userId) throw new ForbiddenException({ code: 'forbidden', message: 'Notes need a signed-in author' });
    return this.tx(a, async (tx) => { await this.mustFind(tx, a, id); const n = await tx.conversationNote.create({ data: { id: uuidv7(), tenantId: a.tenantId, conversationId: id, authorUserId: a.userId as string, body } }); return { id: n.id, body: n.body, createdAt: n.createdAt.toISOString() }; });
  }

  async notes(a: Actor, id: string) {
    return this.tx(a, async (tx) => {
      await this.mustFind(tx, a, id);
      const rows = await tx.conversationNote.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
      const us = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorUserId))] } }, select: { id: true, name: true } });
      const n = new Map(us.map((u) => [u.id, u.name]));
      return rows.map((r) => ({ id: r.id, body: r.body, author: n.get(r.authorUserId) ?? 'Unknown', createdAt: r.createdAt.toISOString() }));
    });
  }

  async setTags(a: Actor, id: string, tags: string[]) {
    this.requireReply(a);
    await this.tx(a, async (tx) => { await this.mustFind(tx, a, id); await tx.conversation.update({ where: { id }, data: { tags: [...new Set(tags.map((t) => t.toLowerCase()))] } }); });
  }

  // ------------------------------------------------------------------ outbound
  send(a: Actor, id: string, input: SendInput) {
    this.requireReply(a);
    if (!a.userId) throw new ForbiddenException({ code: 'forbidden', message: 'Sending needs a signed-in sender' });
    return this.sendAs(a, id, input, 'AGENT');
  }

  /** The AI assistant replies through exactly the same channel rules (24h window, opt-out, channel status) as a human. */
  sendAi(tenantId: string, id: string, text: string) {
    const actor: Actor = { tenantId, userId: null, membershipId: null, permissions: new Set(['conversation:read:all', 'conversation:reply']), requestId: undefined, ip: undefined };
    return this.sendAs(actor, id, { text }, 'AI');
  }

  /** Automations send as the system: same channel rules (consent, 24h window, template registry) as a human. */
  sendSystem(tenantId: string, id: string, input: SendInput) {
    const actor: Actor = { tenantId, userId: null, membershipId: null, permissions: new Set(['conversation:read:all', 'conversation:reply']), requestId: undefined, ip: undefined };
    return this.sendAs(actor, id, input, 'SYSTEM');
  }

  private async sendAs(a: Actor, id: string, input: SendInput, who: 'AGENT' | 'AI' | 'SYSTEM') {
    // Humans are stopped by the HTTP guard when the workspace is read-only; the AI and automations send outside HTTP, so check here too.
    if (who !== 'AGENT' && (await this.ent.get(a.tenantId)).restricted) throw paymentRequired('subscription_required', 'This workspace is read-only until a plan is active, so automatic messages are paused.');
    const prep = await this.tx(a, async (tx) => {
      const c = await this.mustFind(tx, a, id);
      if (input.idempotencyKey) {
        const dupe = await tx.message.findUnique({ where: { tenantId_idempotencyKey: { tenantId: a.tenantId, idempotencyKey: input.idempotencyKey } } });
        if (dupe) return { kind: 'existing' as const, messageId: dupe.id };
      }
      if (who === 'AGENT' && c.mode === 'AI') throw new ConflictException({ code: 'join_required', message: 'The AI assistant is handling this conversation. Join it first to reply.' });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: c.leadId }, select: { phone: true, phoneNorm: true } });
      let template: { name: string; language: string; params: string[] } | null = null;
      if (c.channel.type === 'WHATSAPP') {
        if (c.channel.status !== 'ACTIVE') throw new UnprocessableEntityException({ code: 'channel_unavailable', message: 'This WhatsApp number is not connected right now. Check Integrations.' });
        const consent = await tx.consent.findFirst({ where: { leadId: c.leadId, channel: 'whatsapp' }, orderBy: { createdAt: 'desc' } });
        await this.ent.assertCanSendWhatsapp(tx, a.tenantId);
        if (consent?.status === 'OPTED_OUT') throw new UnprocessableEntityException({ code: 'opted_out', message: 'This customer opted out of WhatsApp messages. You cannot message them here.' });
        const open = this.windowInfo(c).windowOpen;
        if (input.text && !open) throw new UnprocessableEntityException({ code: 'outside_window', message: 'More than 24 hours have passed since the customer last wrote. Send an approved template instead.' });
        if (input.template) {
          if (!consent) throw new UnprocessableEntityException({ code: 'consent_required', message: 'There is no record of this customer opting in to WhatsApp messages.' });
          const t = await tx.whatsappTemplate.findFirst({ where: { tenantId: a.tenantId, name: input.template.name, language: input.template.language } });
          if (!t) throw new UnprocessableEntityException({ code: 'unknown_template', message: 'That template is not registered for this workspace.' });
          if (input.template.params.length !== t.variableCount) throw new UnprocessableEntityException({ code: 'template_params', message: `This template needs ${t.variableCount} value${t.variableCount === 1 ? '' : 's'}.` });
          template = input.template;
        }
      } else if (input.template) throw new UnprocessableEntityException({ code: 'template_not_supported', message: 'Templates are only for WhatsApp.' });

      const body = input.text ?? `Template: ${input.template?.name}`;
      const msgId = uuidv7();
      await tx.message.create({ data: { id: msgId, tenantId: a.tenantId, conversationId: id, channelId: c.channelId, direction: 'OUTBOUND', senderType: who, senderUserId: who === 'AGENT' ? a.userId : null, type: template ? 'TEMPLATE' : 'TEXT', body, template: template ?? undefined, status: c.channel.type === 'WHATSAPP' ? 'QUEUED' : 'DELIVERED', idempotencyKey: input.idempotencyKey ?? null } });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 140), unreadCount: 0, status: 'OPEN', closedAt: null } });
      return { kind: 'new' as const, messageId: msgId, channel: c.channel, channelId: c.channelId, to: lead.phoneNorm, template, text: input.text ?? null, assigned: c.assignedMembershipId };
    });
    if (prep.kind === 'existing') return this.messageView(a, prep.messageId);
    this.notify(a, id, prep.assigned, 'message.created', { messageId: prep.messageId, direction: 'OUTBOUND' });
    if (prep.channel.type === 'WEB_WIDGET') return this.messageView(a, prep.messageId);
    await this.deliver(a, prep.messageId, prep.channelId, prep.to, prep.text, prep.template);
    this.notify(a, id, prep.assigned, 'message.created', { messageId: prep.messageId, direction: 'OUTBOUND' });
    return this.messageView(a, prep.messageId);
  }

  /** Sends via the provider with bounded inline retry for transient failures; records the outcome on the message. */
  private async deliver(a: Actor, messageId: string, channelId: string, to: string | null, text: string | null, template: { name: string; language: string; params: string[] } | null): Promise<void> {
    const { channel, creds } = await this.channels.credentialsFor(a.tenantId, channelId, a.userId);
    if (!to) { await this.fail(a, messageId, new WhatsAppApiError('This lead has no phone number', false)); return; }
    let lastErr: WhatsAppApiError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = template ? await this.wa.sendTemplate(channel.externalId ?? '', creds, to, template.name, template.language, template.params) : await this.wa.sendText(channel.externalId ?? '', creds, to, text ?? '');
        // The provider has the message now. From here on a database hiccup must NEVER turn this into a "failed" message (a retry
        // would send a duplicate to the customer), so the write is retried and degrades to "sent without provider id".
        await this.recordSent(a, messageId, r.messageId);
        return;
      } catch (e) {
        // Unexpected (non-provider) errors are logged for operators; users only ever see a generic message, never internals.
        if (!(e instanceof WhatsAppApiError)) this.log.error(`Unexpected error while sending message ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
        lastErr = e instanceof WhatsAppApiError ? e : new WhatsAppApiError('We could not send this message. Please try again.', false);
        if (!lastErr.retryable || attempt === 2) break;
        await new Promise((r) => setTimeout(r, lastErr?.retryAfterSec ? Math.min(lastErr.retryAfterSec, 2) * 1000 : 400 * (attempt + 1)));
      }
    }
    await this.fail(a, messageId, lastErr as WhatsAppApiError);
  }

  private async recordSent(a: Actor, messageId: string, providerId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.tx(a, async (tx) => {
          // A provider id that already exists would violate the dedupe constraint: keep the message as sent without it.
          const clash = providerId ? await tx.message.findFirst({ where: { externalId: providerId, id: { not: messageId } }, select: { id: true } }) : null;
          await tx.message.update({ where: { id: messageId }, data: { status: 'SENT', externalId: clash ? null : providerId || null, statusUpdatedAt: new Date(), error: Prisma.JsonNull } });
          const m = await tx.message.findUniqueOrThrow({ where: { id: messageId }, select: { conversation: { select: { leadId: true } } } });
          await tx.lead.update({ where: { id: m.conversation.leadId }, data: { lastContactedAt: new Date() } });
        });
        return;
      } catch (e) { this.log.error(`Could not record sent message ${messageId} (attempt ${attempt + 1}): ${e instanceof Error ? e.message : String(e)}`); await new Promise((r) => setTimeout(r, 150 * (attempt + 1))); }
    }
  }

  private async fail(a: Actor, messageId: string, e: WhatsAppApiError): Promise<void> {
    await this.tx(a, (tx) => tx.message.update({ where: { id: messageId }, data: { status: 'FAILED', statusUpdatedAt: new Date(), error: { message: e.message, code: e.code ?? null, retryable: e.retryable, retryAfterSec: e.retryAfterSec ?? null } } }));
  }

  /** Re-sends a failed, retryable message (same window and consent rules apply again). */
  async retry(a: Actor, conversationId: string, messageId: string) {
    this.requireReply(a);
    const prep = await this.tx(a, async (tx) => {
      const c = await this.mustFind(tx, a, conversationId);
      const m = await tx.message.findFirst({ where: { id: messageId, conversationId, direction: 'OUTBOUND', status: 'FAILED' } });
      if (!m) throw new NotFoundException({ code: 'not_found', message: 'No failed message to retry' });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: c.leadId }, select: { phoneNorm: true } });
      const template = m.template as { name: string; language: string; params: string[] } | null;
      if (!template && !this.windowInfo(c).windowOpen) throw new UnprocessableEntityException({ code: 'outside_window', message: 'The 24-hour window has closed. Send an approved template instead.' });
      await tx.message.update({ where: { id: m.id }, data: { status: 'QUEUED', error: Prisma.JsonNull } });
      return { channelId: c.channelId, to: lead.phoneNorm, text: template ? null : m.body, template, assigned: c.assignedMembershipId };
    });
    await this.deliver(a, messageId, prep.channelId, prep.to, prep.text, prep.template);
    this.notify(a, conversationId, prep.assigned, 'message.created', { messageId, direction: 'OUTBOUND' });
    return this.messageView(a, messageId);
  }

  private messageView(a: Actor, id: string) {
    return this.tx(a, async (tx) => { const m = await tx.message.findUniqueOrThrow({ where: { id } }); return { id: m.id, direction: m.direction, type: m.type, body: m.body, status: m.status, error: m.error, createdAt: m.createdAt.toISOString() }; });
  }

  // ------------------------------------------------------------------ media (proxied on demand; nothing is stored)
  async media(a: Actor, conversationId: string, messageId: string): Promise<{ data: Buffer; mime: string; filename: string | null }> {
    const m = await this.tx(a, async (tx) => {
      const c = await this.mustFind(tx, a, conversationId);
      const msg = await tx.message.findFirst({ where: { id: messageId, conversationId } });
      if (!msg?.media || c.channel.type !== 'WHATSAPP') throw new NotFoundException({ code: 'not_found', message: 'No media on this message' });
      return { media: msg.media as { id: string; mime?: string; filename?: string }, channelId: c.channelId };
    });
    const { creds } = await this.channels.credentialsFor(a.tenantId, m.channelId, a.userId);
    try {
      const info = await this.wa.getMedia(creds, m.media.id);
      const file = await this.wa.downloadMedia(creds, info.url);
      if (file.data.length > 16 * 1024 * 1024) throw new UnprocessableEntityException({ code: 'media_too_large', message: 'This file is too large to preview' });
      return { data: file.data, mime: m.media.mime ?? file.mime, filename: m.media.filename ?? null };
    } catch (e) {
      if (e instanceof UnprocessableEntityException) throw e;
      throw new UnprocessableEntityException({ code: 'media_unavailable', message: 'WhatsApp no longer has this file (media expires after about 30 days).' });
    }
  }
}

