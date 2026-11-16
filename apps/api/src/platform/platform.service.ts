import { series } from '../common/series.js';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@leadpilot/database';
import { type PlanInput, FEATURE_KEYS, LIMIT_KEYS, withGst } from '@leadpilot/validation';
import { z } from 'zod';
import { PasswordService } from '../auth/password.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DbService } from '../db/db.module.js';
import { type PlatformAdminCtx, PlatformTokens } from './platform-auth.js';
import { planUpdateSchema, platformAssignPlanSchema, platformTenantsQuerySchema } from '@leadpilot/validation';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const INVALID = { code: 'invalid_credentials', message: 'Invalid email or password' };
type Meta = { ip: string | undefined; requestId: string };

export interface TenantRow { id: string; name: string; email: string; plan_key: string; status: string; created_at: Date; seats: bigint; leads: bigint; sub_status: string | null; trial_ends_at: Date | null; current_period_end: Date | null; price_minor: number | null; provider: string | null }

@Injectable()
export class PlatformService {
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(PasswordService) private readonly passwords: PasswordService, @Inject(PlatformTokens) private readonly tokens: PlatformTokens,
    @Inject(AuditService) private readonly audit: AuditService, @Inject(EntitlementsService) private readonly ent: EntitlementsService,
  ) {}

  /** Append-only record of everything a platform admin does. */
  private log(admin: PlatformAdminCtx | null, meta: Meta, e: { action: string; targetType?: string; targetId?: string; tenantId?: string; reason?: string; metadata?: Prisma.InputJsonObject }) {
    return this.db.prisma.platformAuditLog.createMany({ data: [{ adminId: admin?.id ?? null, action: e.action, targetType: e.targetType ?? null, targetId: e.targetId ?? null, tenantId: e.tenantId ?? null, reason: e.reason ?? null, metadata: e.metadata ?? {}, ip: meta.ip ?? null }] });
  }

  // ------------------------------------------------------------------ auth
  async login(email: string, password: string, meta: Meta): Promise<{ token: string; admin: PlatformAdminCtx }> {
    if (!this.tokens.enabled) throw new UnauthorizedException(INVALID);
    const a = await this.db.prisma.platformAdmin.findUnique({ where: { email } });
    if (!a) { await this.passwords.verifyDummy(password); await this.log(null, meta, { action: 'platform.login_failed', metadata: { reason: 'unknown' } }); throw new UnauthorizedException(INVALID); }
    const locked = a.lockedUntil !== null && a.lockedUntil > new Date();
    const ok = !locked && a.status === 'ACTIVE' && (await this.passwords.verify(a.passwordHash, password));
    if (!ok) {
      if (!locked) { const fails = a.failedLogins + 1; await this.db.prisma.platformAdmin.update({ where: { id: a.id }, data: fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedLogins: fails } }); }
      await this.log({ id: a.id, email: a.email, name: a.name }, meta, { action: 'platform.login_failed', metadata: { reason: locked ? 'locked' : a.status !== 'ACTIVE' ? 'disabled' : 'bad_password' } });
      throw new UnauthorizedException(INVALID);
    }
    await this.db.prisma.platformAdmin.update({ where: { id: a.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const admin = { id: a.id, email: a.email, name: a.name };
    await this.log(admin, meta, { action: 'platform.login' });
    return { token: await this.tokens.sign(a.id), admin };
  }

  // ------------------------------------------------------------------ overview
  async metrics() {
    const rows = await this.db.prisma.$queryRaw<{ m: Record<string, unknown> }[]>`SELECT platform_metrics() AS m`;
    const m = (rows[0]?.m ?? {}) as Record<string, number | Record<string, number>>;
    const num = (k: string) => Number(m[k] ?? 0);
    return {
      tenants: { total: num('tenants_total'), suspended: num('tenants_suspended'), new30d: num('tenants_new_30d'), byPlan: (m.by_plan ?? {}) as Record<string, number> },
      subscriptions: { trialing: num('subs_trialing'), active: num('subs_active'), pastDue: num('subs_past_due'), endedOrExpired: num('subs_expired'), complimentary: num('comped') },
      /** Monthly recurring revenue in paise, EXCLUDING GST: sum of plan prices of paying (non-complimentary) subscriptions. */
      mrrMinor: num('mrr_minor'),
      aiTokensThisMonth: num('ai_tokens_month'),
    };
  }

  async tenants(q: z.infer<typeof platformTenantsQuerySchema>) {
    const rows = await this.db.prisma.$queryRaw<TenantRow[]>`SELECT * FROM platform_tenant_overview(${q.search ?? null}, ${q.status ?? null}, ${q.plan ?? null}, ${q.limit}, ${q.offset})`;
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, planKey: r.plan_key, status: r.status, createdAt: r.created_at.toISOString(), seats: Number(r.seats), leads: Number(r.leads), subscriptionStatus: r.sub_status, trialEndsAt: r.trial_ends_at?.toISOString() ?? null, currentPeriodEnd: r.current_period_end?.toISOString() ?? null, priceMinor: r.price_minor, provider: r.provider }));
  }

  async tenant(id: string) {
    return this.db.tenantTx({ tenantId: id }, async (tx) => {
      const found = await tx.tenant.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new NotFoundException({ code: 'not_found', message: 'Tenant not found' });
      const [t, sub, e, usage, invoices, audit] = await series([ () => tx.tenant.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, email: true, industry: true, planKey: true, status: true, createdAt: true, timezone: true } }), () => tx.subscription.findUnique({ where: { tenantId: id } }), () => this.ent.compute(tx, id), () => this.ent.usage(tx, id), () => tx.invoice.findMany({ where: { tenantId: id }, orderBy: { issuedAt: 'desc' }, take: 10, select: { id: true, number: true, totalMinor: true, issuedAt: true } }), () => tx.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 15, select: { action: true, createdAt: true } })]);
      const owners = await tx.membership.findMany({ where: { tenantId: id, status: 'ACTIVE', role: { key: 'owner' } }, select: { userId: true } });
      const ownerUsers = await this.db.prisma.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } }, select: { name: true, email: true } });
      return {
        tenant: { ...t, createdAt: t.createdAt.toISOString() }, owners: ownerUsers, entitlements: e, usage,
        subscription: sub ? { status: sub.status, provider: sub.provider, planKey: sub.planKey, pendingPlanKey: sub.pendingPlanKey, trialEndsAt: sub.trialEndsAt?.toISOString() ?? null, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null, graceEndsAt: sub.graceEndsAt?.toISOString() ?? null, cancelAtPeriodEnd: sub.cancelAtPeriodEnd } : null,
        invoices: invoices.map((i) => ({ ...i, issuedAt: i.issuedAt.toISOString() })), recentActivity: audit.map((a) => ({ action: a.action, at: a.createdAt.toISOString() })),
      };
    });
  }

  // ------------------------------------------------------------------ tenant actions (each needs a reason and is audited on both sides)
  private async onTenantAudit(tenantId: string, admin: PlatformAdminCtx, meta: Meta, action: string, reason: string, metadata: Prisma.InputJsonObject = {}) {
    await this.db.tenantTx({ tenantId }, (tx) => this.audit.record(tx, { tenantId, actorUserId: null, action, resourceType: 'tenant', resourceId: tenantId, metadata: { ...metadata, byPlatformAdmin: admin.id, reason }, requestId: meta.requestId, ip: meta.ip }));
    await this.log(admin, meta, { action, targetType: 'tenant', targetId: tenantId, tenantId, reason, metadata });
  }

  async setTenantStatus(admin: PlatformAdminCtx, meta: Meta, id: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) {
    const rows = await this.db.prisma.$queryRaw<{ ok: boolean }[]>`SELECT platform_set_tenant_status(${id}::uuid, ${status}) AS ok`;
    if (!rows[0]?.ok) throw new NotFoundException({ code: 'not_found', message: 'Tenant not found' });
    this.ent.invalidate(id);
    await this.onTenantAudit(id, admin, meta, status === 'SUSPENDED' ? 'platform.tenant_suspended' : 'platform.tenant_reactivated', reason);
    return { id, status };
  }

  async assignPlan(admin: PlatformAdminCtx, meta: Meta, id: string, input: z.infer<typeof platformAssignPlanSchema>) {
    const plan = await this.db.prisma.plan.findUnique({ where: { key: input.planKey } });
    if (!plan || !plan.active) throw new BadRequestException({ code: 'plan_unavailable', message: 'That plan is not available' });
    if (input.mode === 'trial' && !input.days) throw new BadRequestException({ code: 'days_required', message: 'Give the number of trial days' });
    await this.db.tenantTx({ tenantId: id }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id }, select: { id: true } });
      if (!t) throw new NotFoundException({ code: 'not_found', message: 'Tenant not found' });
      const sub = await tx.subscription.findUnique({ where: { tenantId: id } });
      if (sub?.provider === 'razorpay' && sub.providerSubscriptionId && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) throw new ConflictException({ code: 'has_paid_subscription', message: 'This workspace has a live paid subscription. Ask them to cancel it first, or change their plan through billing.' });
      const now = Date.now();
      const data = input.mode === 'trial'
        ? { planKey: plan.key, status: 'TRIALING' as const, provider: 'none', providerSubscriptionId: null, pendingPlanKey: null, trialEndsAt: new Date(now + (input.days as number) * 86_400_000), currentPeriodEnd: null, graceEndsAt: null, cancelAtPeriodEnd: false }
        : { planKey: plan.key, status: 'ACTIVE' as const, provider: 'manual', providerSubscriptionId: null, pendingPlanKey: null, trialEndsAt: null, currentPeriodEnd: input.days ? new Date(now + input.days * 86_400_000) : null, graceEndsAt: null, cancelAtPeriodEnd: false };
      if (sub) await tx.subscription.update({ where: { tenantId: id }, data }); else await tx.subscription.create({ data: { tenantId: id, ...data } });
      await tx.tenant.update({ where: { id }, data: { planKey: plan.key } });
    });
    this.ent.invalidate(id);
    await this.onTenantAudit(id, admin, meta, 'platform.plan_assigned', input.reason, { planKey: input.planKey, mode: input.mode, days: input.days ?? null });
    return { id, planKey: input.planKey, mode: input.mode };
  }

  // ------------------------------------------------------------------ plans
  async plans() {
    const rows = await this.db.prisma.plan.findMany({ include: { entitlements: true }, orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }] });
    // `tenants` is under RLS (invisible without a tenant in scope), so counts come from the SECURITY DEFINER metrics function.
    const byPlan = (await this.metrics()).tenants.byPlan;
    return rows.map((p) => ({ key: p.key, name: p.name, description: p.description, priceMinor: p.priceMinor, priceWithGstMinor: withGst(p.priceMinor), trialDays: p.trialDays, isPublic: p.isPublic, active: p.active, sortOrder: p.sortOrder, tenants: Number(byPlan[p.key] ?? 0),
      entitlements: [...LIMIT_KEYS, ...FEATURE_KEYS].map((k) => { const e = p.entitlements.find((x) => x.key === k); return { key: k, enabled: e?.enabled ?? false, limit: e?.limit ?? null }; }) }));
  }

  async createPlan(admin: PlatformAdminCtx, meta: Meta, input: PlanInput) {
    if (await this.db.prisma.plan.findUnique({ where: { key: input.key } })) throw new ConflictException({ code: 'plan_exists', message: 'A plan with this key already exists' });
    await this.db.prisma.$transaction(async (tx) => {
      await tx.plan.create({ data: { key: input.key, name: input.name, description: input.description, priceMinor: input.priceMinor, trialDays: input.trialDays, isPublic: input.isPublic, active: input.active, sortOrder: input.sortOrder } });
      await tx.planEntitlement.createMany({ data: input.entitlements.map((e) => ({ planKey: input.key, key: e.key, enabled: e.enabled, limit: e.limit })) });
    });
    await this.log(admin, meta, { action: 'platform.plan_created', targetType: 'plan', targetId: input.key, metadata: { priceMinor: input.priceMinor } });
    return (await this.plans()).find((p) => p.key === input.key);
  }

  async updatePlan(admin: PlatformAdminCtx, meta: Meta, key: string, input: z.infer<typeof planUpdateSchema>) {
    const cur = await this.db.prisma.plan.findUnique({ where: { key } });
    if (!cur) throw new NotFoundException({ code: 'not_found', message: 'Plan not found' });
    if (key === 'internal' && (input.active === false || input.entitlements)) throw new BadRequestException({ code: 'protected_plan', message: 'The internal plan cannot be deactivated or limited' });
    const { entitlements, ...fields } = input;
    await this.db.prisma.$transaction(async (tx) => {
      if (Object.keys(fields).length) await tx.plan.update({ where: { key }, data: fields });
      if (entitlements) { await tx.planEntitlement.deleteMany({ where: { planKey: key } }); await tx.planEntitlement.createMany({ data: entitlements.map((e) => ({ planKey: key, key: e.key, enabled: e.enabled, limit: e.limit })) }); }
    });
    // Limits changed under live customers: drop the local cache so this process applies them immediately (others within seconds).
    const tenants = await this.db.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM platform_tenant_overview(${null}, ${null}, ${key}, 200, 0)`;
    for (const t of tenants) this.ent.invalidate(t.id);
    await this.log(admin, meta, { action: 'platform.plan_updated', targetType: 'plan', targetId: key, metadata: { fields: Object.keys(fields), entitlements: !!entitlements, priceChanged: fields.priceMinor !== undefined && fields.priceMinor !== cur.priceMinor } });
    return (await this.plans()).find((p) => p.key === key);
  }

  async auditLog(limit = 100) {
    const rows = await this.db.prisma.platformAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 200) });
    const admins = await this.db.prisma.platformAdmin.findMany({ where: { id: { in: rows.flatMap((r) => (r.adminId ? [r.adminId] : [])) } }, select: { id: true, email: true } });
    return rows.map((r) => ({ id: r.id, action: r.action, admin: admins.find((a) => a.id === r.adminId)?.email ?? null, targetType: r.targetType, targetId: r.targetId, tenantId: r.tenantId, reason: r.reason, createdAt: r.createdAt.toISOString() }));
  }
}

