import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { packForIndustry, packTerms } from '@leadpilot/shared-types';
import type { PortalConfigInput } from '@leadpilot/validation';
import { PORTAL_KEY_REGEX } from '@leadpilot/validation';
import { AuditService } from '../audit/audit.service.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { normalizeEmail, normalizePhone } from '../common/phone.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { DbService } from '../db/db.module.js';
import { MailService } from '../mail/mail.module.js';
import { CODE_TTL_MINUTES, CODE_WINDOW_MINUTES, MAX_CODE_ATTEMPTS, MAX_CODES_PER_WINDOW, PORTAL_SESSION_MINUTES, dummyHash, deriveKey, generateCode, hashCode, hashIdentity, newPortalKey, safeEqualHex, signPortalSession, verifyPortalSession } from './portal-auth.js';

export interface PortalRow { tenant_id: string; enabled: boolean; allow_confirm: boolean; allow_cancel: boolean; allow_reschedule: boolean; cancel_cutoff_hours: number; business_name: string; logo_url: string | null; timezone: string }
/** What a verified portal session may touch: this workspace, and only these leads (the signed-in lead plus leads merged into it). */
export interface PortalCtx { tenantId: string; sessionId: string; primaryLeadId: string; leadIds: string[]; cfg: PortalRow }

const WA_TEMPLATE = 'portal_login_code';
const MIN = 60_000;

/** Parses what the customer typed. Never confirms that anything exists. */
export function parseIdentity(raw: string): { kind: 'email' | 'phone'; norm: string } | null {
  if (raw.includes('@')) { const e = normalizeEmail(raw); return e ? { kind: 'email', norm: e } : null; }
  const p = normalizePhone(raw);
  return p ? { kind: 'phone', norm: p.norm } : null;
}

@Injectable()
export class PortalService {
  private readonly log = new Logger('Portal');
  private readonly sessionKey: Buffer; private readonly codeKey: Buffer;
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(EntitlementsService) private readonly ent: EntitlementsService, @Inject(MailService) private readonly mail: MailService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService, @Inject(AuditService) private readonly audit: AuditService, @Inject(ENV) private readonly env: Env,
  ) {
    this.sessionKey = deriveKey(env.JWT_ACCESS_SECRET, 'lead-portal-session');
    this.codeKey = deriveKey(env.JWT_ACCESS_SECRET, 'lead-portal-code');
  }

  // ------------------------------------------------------------------ which business, and is the portal available
  async byKey(key: string): Promise<PortalRow | null> {
    if (!PORTAL_KEY_REGEX.test(key)) return null;
    return (await this.db.userTx(null, (tx) => tx.$queryRaw<PortalRow[]>`SELECT * FROM find_portal_by_public_key(${key})`))[0] ?? null;
  }
  /** Unknown key, switched off, or not in the plan: all the same "not available" (never says which). */
  async open(key: string): Promise<PortalRow> {
    const p = await this.byKey(key);
    if (!p || !p.enabled || !(await this.ent.get(p.tenant_id)).features.lead_portal) throw new NotFoundException({ code: 'not_found', message: 'This page is not available' });
    return p;
  }
  signInPage(p: PortalRow) { return { businessName: p.business_name, logoUrl: p.logo_url }; }

  // ------------------------------------------------------------------ one-time code
  /**
   * Always answers the same way. A code is created and sent only if the typed phone/email matches a lead, the per-identity limit is not
   * reached, and there is a way to reach the lead: the EMAIL ON FILE, or a WhatsApp template the business registered. The code goes to
   * the contact on file, never to whatever was typed, so typing someone else's number cannot redirect it.
   */
  async requestCode(key: string, raw: string): Promise<void> {
    const p = await this.open(key);
    const id = parseIdentity(raw);
    if (!id) throw new BadRequestException({ code: 'validation_error', message: 'Enter your phone number or email address' });
    const tenantId = p.tenant_id; const identityHash = hashIdentity(this.codeKey, tenantId, `${id.kind}:${id.norm}`);
    const now = Date.now();
    const plan = await this.db.tenantTx({ tenantId }, async (tx) => {
      await tx.portalLoginCode.deleteMany({ where: { tenantId, createdAt: { lt: new Date(now - 24 * 60 * MIN) } } }); // tidy up old codes
      if ((await tx.portalLoginCode.count({ where: { tenantId, identityHash, createdAt: { gt: new Date(now - CODE_WINDOW_MINUTES * MIN) } } })) >= MAX_CODES_PER_WINDOW) return null;
      const lead = await tx.lead.findFirst({ where: { tenantId, deletedAt: null, mergedIntoId: null, ...(id.kind === 'email' ? { emailNorm: id.norm } : { phoneNorm: id.norm }) }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, phoneNorm: true } });
      if (!lead) return null;
      let route: { channel: 'email'; to: string } | { channel: 'whatsapp'; conversationId: string; language: string } | null = null;
      if (lead.email) route = { channel: 'email', to: lead.email };
      else if (lead.phoneNorm) { const wa = await this.whatsappRoute(tx, tenantId, lead.id); if (wa) route = { channel: 'whatsapp', ...wa }; }
      if (!route) return null;
      const code = generateCode();
      const row = await tx.portalLoginCode.create({ data: { tenantId, leadId: lead.id, identityHash, channel: route.channel, codeHash: hashCode(this.codeKey, tenantId, identityHash, code), expiresAt: new Date(now + CODE_TTL_MINUTES * MIN) } });
      return { route, code, codeId: row.id };
    });
    if (!plan) return;
    // Delivery runs after the answer is decided, so a slow mail server cannot tell a visitor whether a lead matched.
    void this.deliver(tenantId, p.business_name, plan).catch((e: unknown) => this.log.error(`Could not deliver a portal code: ${e instanceof Error ? e.message : 'unknown error'}`));
  }

  /** A WhatsApp route exists only with an active channel, an existing conversation, a consent record that is not an opt-out, and an approved template. */
  private async whatsappRoute(tx: Parameters<Parameters<DbService['tenantTx']>[1]>[0], tenantId: string, leadId: string): Promise<{ conversationId: string; language: string } | null> {
    const convo = await tx.conversation.findFirst({ where: { tenantId, leadId, channel: { type: 'WHATSAPP', status: 'ACTIVE' } }, orderBy: { lastMessageAt: 'desc' }, select: { id: true } });
    if (!convo) return null;
    const consent = await tx.consent.findFirst({ where: { leadId, channel: 'whatsapp' }, orderBy: { createdAt: 'desc' }, select: { status: true } });
    if (!consent || consent.status === 'OPTED_OUT') return null;
    const tpl = await tx.whatsappTemplate.findFirst({ where: { tenantId, name: WA_TEMPLATE, variableCount: 1, OR: [{ approvalStatus: null }, { approvalStatus: 'APPROVED' }] }, select: { language: true } });
    return tpl ? { conversationId: convo.id, language: tpl.language } : null;
  }

  private async deliver(tenantId: string, businessName: string, d: { route: { channel: 'email'; to: string } | { channel: 'whatsapp'; conversationId: string; language: string }; code: string; codeId: string }): Promise<void> {
    if (d.route.channel === 'email') { await this.mail.sendPortalCode(d.route.to, d.code, businessName); return; }
    const m = await this.conversations.sendSystem(tenantId, d.route.conversationId, { template: { name: WA_TEMPLATE, language: d.route.language, params: [d.code] }, idempotencyKey: `portal-code:${d.codeId}` }) as { id?: string };
    // The message record keeps the template values: scrub the code so staff reading the inbox cannot sign in as the customer.
    if (m.id) await this.db.tenantTx({ tenantId }, (tx) => tx.message.updateMany({ where: { id: m.id as string, tenantId }, data: { template: { name: WA_TEMPLATE, language: d.route.channel === 'whatsapp' ? d.route.language : 'en', params: ['******'] } } }));
  }

  /**
   * Checks a code. Every failure (no such lead, wrong, expired, used, too many tries) is the same 401, and the same work is done, so the
   * answer tells an attacker nothing. A code dies after 5 wrong tries; new codes are limited per identity, so guessing is hopeless.
   */
  async verifyCode(key: string, raw: string, code: string): Promise<{ token: string }> {
    const p = await this.open(key);
    const fail = () => new UnauthorizedException({ code: 'invalid_code', message: 'That code is not valid or has expired. Request a new one.' });
    const id = parseIdentity(raw);
    const tenantId = p.tenant_id; const identityHash = hashIdentity(this.codeKey, tenantId, id ? `${id.kind}:${id.norm}` : 'invalid');
    const given = hashCode(this.codeKey, tenantId, identityHash, code);
    const now = new Date();
    const sessionId = await this.db.tenantTx({ tenantId }, async (tx) => {
      const row = id ? await tx.portalLoginCode.findFirst({ where: { tenantId, identityHash, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_CODE_ATTEMPTS } }, orderBy: { createdAt: 'desc' } }) : null;
      const matches = safeEqualHex(row?.codeHash ?? dummyHash(this.codeKey), given) && row !== null; // compared even when there is no row
      if (!row) return null;
      if (!matches) { await tx.portalLoginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }); return null; }
      if ((await tx.portalLoginCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } })).count !== 1) return null; // single use, even under a race
      const lead = await tx.lead.findFirst({ where: { id: row.leadId, tenantId, deletedAt: null }, select: { id: true } });
      if (!lead) return null;
      const s = await tx.portalSession.create({ data: { tenantId, leadId: lead.id, expiresAt: new Date(now.getTime() + PORTAL_SESSION_MINUTES * MIN) } });
      await this.audit.record(tx, { tenantId, actorUserId: null, action: 'portal.signed_in', resourceType: 'lead', resourceId: lead.id, metadata: { channel: row.channel } });
      return s.id;
    });
    if (!sessionId) throw fail();
    return { token: await signPortalSession(this.sessionKey, { sessionId, tenantId }) };
  }

  // ------------------------------------------------------------------ session
  /** Returns what this session may touch, or null (expired, revoked, lead erased, portal off or out of plan). Called on every portal request. */
  async authenticate(token: string): Promise<PortalCtx | null> {
    const claims = await verifyPortalSession(this.sessionKey, token);
    if (!claims) return null;
    const { tenantId } = claims;
    const ctx = await this.db.tenantTx({ tenantId }, async (tx) => {
      const now = new Date();
      const s = await tx.portalSession.findFirst({ where: { id: claims.sessionId, tenantId, revokedAt: null, expiresAt: { gt: now } } });
      if (!s) return null;
      const lead = await tx.lead.findFirst({ where: { id: s.leadId, tenantId, deletedAt: null }, select: { id: true, mergedIntoId: true } });
      if (!lead) return null;
      const root = lead.mergedIntoId ?? lead.id;
      const leads = await tx.lead.findMany({ where: { tenantId, deletedAt: null, OR: [{ id: root }, { mergedIntoId: root }] }, select: { id: true } });
      const cfg = await tx.portalConfig.findUnique({ where: { tenantId } });
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, logoUrl: true, timezone: true } });
      if (!cfg?.enabled || !t || leads.length === 0) return null;
      if (now.getTime() - s.lastSeenAt.getTime() > 5 * MIN) await tx.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: now } });
      const row: PortalRow = { tenant_id: tenantId, enabled: cfg.enabled, allow_confirm: cfg.allowConfirm, allow_cancel: cfg.allowCancel, allow_reschedule: cfg.allowReschedule, cancel_cutoff_hours: cfg.cancelCutoffHours, business_name: t.name, logo_url: t.logoUrl, timezone: t.timezone };
      return { tenantId, sessionId: s.id, primaryLeadId: root, leadIds: leads.map((l) => l.id), cfg: row } satisfies PortalCtx;
    });
    if (!ctx || !(await this.ent.get(tenantId)).features.lead_portal) return null;
    return ctx;
  }

  async logout(c: PortalCtx): Promise<void> { await this.db.tenantTx({ tenantId: c.tenantId }, (tx) => tx.portalSession.updateMany({ where: { id: c.sessionId, tenantId: c.tenantId }, data: { revokedAt: new Date() } })); }
  /** Ends every portal session of the workspace (portal switched off, key rotated). */
  async revokeAll(tx: Parameters<Parameters<DbService['tenantTx']>[1]>[0], tenantId: string): Promise<void> { await tx.portalSession.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: new Date() } }); }

  // ------------------------------------------------------------------ what the lead sees (customer-safe: nothing internal)
  async me(c: PortalCtx) {
    return this.db.tenantTx({ tenantId: c.tenantId }, async (tx) => {
      const lead = await tx.lead.findFirstOrThrow({ where: { id: c.primaryLeadId, tenantId: c.tenantId }, select: { name: true } });
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { industryPackId: true } });
      const terms = packTerms(packForIndustry(t.industryPackId));
      return {
        businessName: c.cfg.business_name, logoUrl: c.cfg.logo_url, firstName: lead.name.trim().split(/\s+/)[0] ?? lead.name, timezone: c.cfg.timezone,
        appointmentNoun: terms.visit.toLowerCase(), appointmentNounPlural: terms.visits,
        allow: { confirm: c.cfg.allow_confirm, cancel: c.cfg.allow_cancel, reschedule: c.cfg.allow_reschedule }, cancelCutoffHours: c.cfg.cancel_cutoff_hours,
      };
    });
  }

  /** The customer-safe appointment shape. Deliberately explicit: a new database column never appears here by accident. */
  async appointments(c: PortalCtx) {
    const now = new Date();
    const rows = await this.db.tenantTx({ tenantId: c.tenantId }, async (tx) => {
      const appts = await tx.appointment.findMany({ where: { tenantId: c.tenantId, leadId: { in: c.leadIds } }, orderBy: { startsAt: 'desc' }, take: 100, select: { id: true, title: true, startsAt: true, endsAt: true, status: true, location: true, membershipId: true } });
      const ms = await tx.membership.findMany({ where: { id: { in: [...new Set(appts.map((a) => a.membershipId))] } }, select: { id: true, userId: true } });
      return { appts, ms };
    });
    const users = await this.db.prisma.user.findMany({ where: { id: { in: rows.ms.map((m) => m.userId) } }, select: { id: true, name: true } });
    const first = new Map(rows.ms.map((m) => [m.id, (users.find((u) => u.id === m.userId)?.name ?? '').trim().split(/\s+/)[0] || null]));
    const cutoff = c.cfg.cancel_cutoff_hours * 3_600_000;
    const items = rows.appts.map((a) => {
      const open = a.status === 'PENDING' || a.status === 'CONFIRMED'; const future = a.startsAt.getTime() > now.getTime(); const beyondCutoff = a.startsAt.getTime() - now.getTime() > cutoff;
      return {
        id: a.id, title: a.title, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), status: a.status, location: a.location, agentFirstName: first.get(a.membershipId) ?? null,
        canConfirm: c.cfg.allow_confirm && a.status === 'PENDING' && future, canCancel: c.cfg.allow_cancel && open && future && beyondCutoff, canReschedule: c.cfg.allow_reschedule && open && future && beyondCutoff,
      };
    });
    return { upcoming: items.filter((a) => (a.status === 'PENDING' || a.status === 'CONFIRMED') && new Date(a.startsAt) > now).sort((x, y) => x.startsAt.localeCompare(y.startsAt)), past: items.filter((a) => !((a.status === 'PENDING' || a.status === 'CONFIRMED') && new Date(a.startsAt) > now)).slice(0, 30) };
  }

  // ------------------------------------------------------------------ staff settings
  private view(cfg: { publicKey: string; enabled: boolean; allowConfirm: boolean; allowCancel: boolean; allowReschedule: boolean; cancelCutoffHours: number } | null, available: boolean) {
    return { available, configured: cfg !== null, enabled: cfg?.enabled ?? false, url: cfg ? `${this.env.WEB_ORIGIN}/p/${cfg.publicKey}` : null, allowConfirm: cfg?.allowConfirm ?? true, allowCancel: cfg?.allowCancel ?? true, allowReschedule: cfg?.allowReschedule ?? true, cancelCutoffHours: cfg?.cancelCutoffHours ?? 4 };
  }
  async getConfig(ctx: TenantRequestContext) {
    const available = (await this.ent.get(ctx.tenantId)).features.lead_portal;
    return this.view(await this.db.tenantTx(ctx, (tx) => tx.portalConfig.findUnique({ where: { tenantId: ctx.tenantId } })), available);
  }
  async saveConfig(ctx: TenantRequestContext, input: PortalConfigInput) {
    await this.ent.assertFeature(ctx.tenantId, 'lead_portal');
    const cfg = await this.db.tenantTx(ctx, async (tx) => {
      const had = await tx.portalConfig.findUnique({ where: { tenantId: ctx.tenantId } });
      const data = { enabled: input.enabled, allowConfirm: input.allowConfirm, allowCancel: input.allowCancel, allowReschedule: input.allowReschedule, cancelCutoffHours: input.cancelCutoffHours };
      const saved = had ? await tx.portalConfig.update({ where: { tenantId: ctx.tenantId }, data }) : await tx.portalConfig.create({ data: { tenantId: ctx.tenantId, publicKey: newPortalKey(), ...data } });
      if (had?.enabled && !input.enabled) await this.revokeAll(tx, ctx.tenantId); // switching it off ends every session
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'portal.config_updated', resourceType: 'portal', resourceId: saved.id, metadata: { enabled: input.enabled }, requestId: ctx.requestId, ip: ctx.ip });
      return saved;
    });
    return this.view(cfg, true);
  }
  async rotateKey(ctx: TenantRequestContext) {
    await this.ent.assertFeature(ctx.tenantId, 'lead_portal');
    const cfg = await this.db.tenantTx(ctx, async (tx) => {
      if (!(await tx.portalConfig.findUnique({ where: { tenantId: ctx.tenantId } }))) throw new ConflictException({ code: 'not_configured', message: 'Set up the customer portal first.' });
      const saved = await tx.portalConfig.update({ where: { tenantId: ctx.tenantId }, data: { publicKey: newPortalKey() } });
      await this.revokeAll(tx, ctx.tenantId); // the old address stops working and everyone is signed out
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'portal.key_rotated', resourceType: 'portal', resourceId: saved.id, metadata: {}, requestId: ctx.requestId, ip: ctx.ip });
      return saved;
    });
    return this.view(cfg, true);
  }
}
