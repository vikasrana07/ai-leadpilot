import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { supportAccessSettingSchema, supportSessionStartSchema } from '@leadpilot/validation';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { CurrentTenant, NoTenant, Public, RequirePermissions } from '../common/decorators.js';
import { ACCESS_COOKIE } from '../common/middleware.js';
import type { AppRequest, TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { MfaModule } from '../mfa/mfa.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { BillingNotifier } from '../ops/billing-notify.js';
import { PlatformGuard, PlatformTokens, type PlatformRequest } from '../platform/platform-auth.js';
import { SUPPORT_MAX_MINUTES } from './support-access.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
type Meta = { ip: string | undefined; requestId: string };

@Injectable()
export class SupportService {
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(PasswordService) private readonly passwords: PasswordService, @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuditService) private readonly audit: AuditService, @Inject(BillingNotifier) private readonly notifier: BillingNotifier, @Inject(ENV) private readonly env: Env,
  ) {}

  private async platformLog(adminId: string, tenantId: string, action: string, meta: Meta, extra: { targetId?: string; reason?: string; metadata?: Record<string, string | number> } = {}) {
    await this.db.prisma.platformAuditLog.createMany({ data: [{ adminId, action, targetType: 'support_session', targetId: extra.targetId ?? null, tenantId, reason: extra.reason ?? null, metadata: extra.metadata ?? {}, ip: meta.ip ?? null }] });
  }

  /** Re-checks the admin's password (this is a sensitive action, so a stolen console cookie alone is not enough) with the same lockout as login. */
  private async confirmPassword(adminId: string, password: string, meta: Meta, tenantId: string): Promise<{ name: string }> {
    const a = await this.db.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!a || a.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'unauthenticated', message: 'Platform sign-in required' });
    const locked = a.lockedUntil !== null && a.lockedUntil > new Date();
    const ok = !locked && (await this.passwords.verify(a.passwordHash, password));
    if (!ok) {
      if (!locked) { const fails = a.failedLogins + 1; await this.db.prisma.platformAdmin.update({ where: { id: a.id }, data: fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedLogins: fails } }); }
      await this.platformLog(adminId, tenantId, 'platform.support_password_failed', meta);
      throw new UnauthorizedException({ code: 'invalid_credentials', message: 'Password incorrect' });
    }
    if (a.failedLogins > 0) await this.db.prisma.platformAdmin.update({ where: { id: a.id }, data: { failedLogins: 0 } });
    return { name: a.name };
  }

  async start(adminId: string, tenantId: string, input: z.infer<typeof supportSessionStartSchema>, meta: Meta) {
    const admin = await this.confirmPassword(adminId, input.password, meta, tenantId);
    const t = await this.db.tenantTx({ tenantId }, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, status: true, settings: true } }));
    if (!t || t.status !== 'ACTIVE') throw new NotFoundException({ code: 'not_found', message: 'Workspace not found or not active' });
    if ((t.settings as { supportAccess?: boolean } | null)?.supportAccess === false) {
      await this.platformLog(adminId, tenantId, 'platform.support_refused', meta, { reason: input.reason, metadata: { why: 'disabled_by_owner' } });
      throw new ForbiddenException({ code: 'support_access_disabled', message: 'This workspace has switched off support access.' });
    }
    const minutes = Math.min(input.minutes, SUPPORT_MAX_MINUTES);
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const row = await this.db.prisma.supportAccessSession.create({ data: { tenantId, adminId, adminName: admin.name, reason: input.reason, expiresAt, ip: meta.ip ?? null } });
    const token = await this.tokens.signSupport({ adminId, sessionId: row.id, tenantId, minutes });
    await this.db.tenantTx({ tenantId }, (tx) => this.audit.record(tx, { tenantId, actorUserId: null, action: 'support.session_started', resourceType: 'support_session', resourceId: row.id, metadata: { adminName: admin.name, reason: input.reason, expiresAt: expiresAt.toISOString(), readOnly: true }, requestId: meta.requestId, ip: meta.ip }));
    await this.platformLog(adminId, tenantId, 'platform.support_session_started', meta, { targetId: row.id, reason: input.reason, metadata: { minutes } });
    await this.notifier.notifyOwners(tenantId, { type: 'security', title: 'LeadPilot support opened a read-only session', body: `${admin.name} until ${expiresAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Reason: ${input.reason}`, link: '/audit',
      email: { subject: 'LeadPilot support is viewing your workspace (read-only)', text: `${admin.name} from LeadPilot support opened a read-only session on your workspace until ${expiresAt.toISOString()}.\nReason given: ${input.reason}\n\nSupport cannot change anything. You can switch support access off under Settings.` } }).catch(() => undefined);
    return { token, sessionId: row.id, tenantName: t.name, expiresAt: expiresAt.toISOString(), minutes };
  }

  async end(sessionId: string, tenantId: string, by: { adminId: string; adminName: string; ip: string | undefined; requestId: string }, how: 'tenant' | 'platform' | 'owner_disabled') {
    const r = await this.db.prisma.$queryRaw<{ ended: boolean }[]>`SELECT support_session_end(${sessionId}::uuid, ${tenantId}::uuid) AS ended`;
    if (!r[0]?.ended) return false;
    await this.db.tenantTx({ tenantId }, (tx) => this.audit.record(tx, { tenantId, actorUserId: null, action: 'support.session_ended', resourceType: 'support_session', resourceId: sessionId, metadata: { adminName: by.adminName, by: how }, requestId: by.requestId, ip: by.ip }));
    await this.platformLog(by.adminId, tenantId, 'platform.support_session_ended', { ip: by.ip, requestId: by.requestId }, { targetId: sessionId, metadata: { by: how } });
    await this.notifier.notifyOwners(tenantId, { type: 'security', title: 'The LeadPilot support session ended', body: `${by.adminName}'s read-only session is over.`, link: '/audit' }).catch(() => undefined);
    return true;
  }

  async setTenantSetting(ctx: TenantRequestContext, enabled: boolean) {
    const ended = await this.db.tenantTx(ctx, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
      await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...((t.settings ?? {}) as object), supportAccess: enabled } } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: enabled ? 'support.access_enabled' : 'support.access_disabled', resourceType: 'tenant', resourceId: ctx.tenantId, requestId: ctx.requestId, ip: ctx.ip });
      return 0;
    });
    // Switching support access off also ends anything open right now.
    if (!enabled) await this.db.prisma.$queryRaw`SELECT support_sessions_end_all(${ctx.tenantId}::uuid)`;
    return { enabled, endedOpenSessions: ended };
  }

  async getTenantSetting(ctx: TenantRequestContext) {
    const t = await this.db.tenantTx(ctx, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } }));
    return { enabled: (t.settings as { supportAccess?: boolean } | null)?.supportAccess !== false };
  }

  async listForPlatform(tenantId: string | undefined) {
    const rows = await this.db.prisma.supportAccessSession.findMany({ where: tenantId ? { tenantId } : {}, orderBy: { startedAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, admin: r.adminName, reason: r.reason, startedAt: r.startedAt.toISOString(), expiresAt: r.expiresAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null, active: !r.endedAt && r.expiresAt > new Date() }));
  }

  async find(id: string): Promise<{ tenantId: string } | null> { const r = await this.db.prisma.supportAccessSession.findUnique({ where: { id }, select: { tenantId: true } }); return r; }

  get cookieSecure(): boolean { return this.env.NODE_ENV === 'production'; }
}

/** Tenant side: who is looking, and the End button. Open to any authenticated caller (a normal user simply gets `active: false`). */
@Controller()
class SupportSessionController {
  constructor(@Inject(SupportService) private readonly svc: SupportService) {}

  @NoTenant() @Get('support-session')
  current(@Req() req: AppRequest) {
    const s = req.support;
    return s ? { active: true, adminName: s.adminName, reason: s.reason, expiresAt: s.expiresAt.toISOString(), readOnly: true } : { active: false };
  }

  @NoTenant() @Post('support-session/end') @HttpCode(200)
  async end(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const s = req.support; const tenantId = req.auth?.activeTenantId;
    if (!s || !tenantId) throw new ForbiddenException({ code: 'not_a_support_session', message: 'Only a support session can be ended here' });
    await this.svc.end(s.sessionId, tenantId, { adminId: s.adminId, adminName: s.adminName, ip: req.ip, requestId: req.requestId }, 'tenant');
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    return { ended: true };
  }

  /** The workspace owner's switch: support access can be turned off entirely (and open sessions end at once). */
  @Get('support-access') @RequirePermissions('settings:manage') get(@CurrentTenant() c: TenantRequestContext) { return this.svc.getTenantSetting(c); }
  @Put('support-access') @RequirePermissions('settings:manage') set(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(supportAccessSettingSchema)) b: { enabled: boolean }) { return this.svc.setTenantSetting(c, b.enabled); }
}

const LOGIN_THROTTLE = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };
const meta = (r: PlatformRequest): Meta => ({ ip: r.ip, requestId: r.requestId });

/** Platform side. `@Public()` only switches off tenant guards; PlatformGuard protects each route. */
@Public() @Controller('platform')
class SupportPlatformController {
  constructor(@Inject(SupportService) private readonly svc: SupportService, @Inject(ENV) private readonly env: Env) {}

  @UseGuards(PlatformGuard) @Throttle(LOGIN_THROTTLE) @Post('tenants/:id/support-session') @HttpCode(200)
  async start(@Req() req: PlatformRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(supportSessionStartSchema)) b: z.infer<typeof supportSessionStartSchema>, @Res({ passthrough: true }) res: Response) {
    if (!req.platformAdmin) throw new Error('platform guard missing');
    const r = await this.svc.start(req.platformAdmin.id, id, b, meta(req));
    // The support token replaces any tenant login cookie in this browser (use a separate browser profile for support work).
    res.cookie(ACCESS_COOKIE, r.token, { httpOnly: true, secure: this.svc.cookieSecure, sameSite: 'lax', path: '/', maxAge: r.minutes * 60_000 });
    return { sessionId: r.sessionId, tenantName: r.tenantName, expiresAt: r.expiresAt, openUrl: `${this.env.WEB_ORIGIN}/dashboard`, token: this.env.NODE_ENV === 'production' ? undefined : r.token };
  }

  @UseGuards(PlatformGuard) @Get('support-sessions')
  list(@Query('tenantId') tenantId?: string) { return this.svc.listForPlatform(tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : undefined); }

  @UseGuards(PlatformGuard) @Post('support-sessions/:id/end') @HttpCode(200)
  async endFromPlatform(@Req() req: PlatformRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    if (!req.platformAdmin) throw new Error('platform guard missing');
    const row = await this.svc.find(id);
    if (!row) throw new NotFoundException({ code: 'not_found', message: 'Session not found' });
    const ended = await this.svc.end(id, row.tenantId, { adminId: req.platformAdmin.id, adminName: req.platformAdmin.name, ip: req.ip, requestId: req.requestId }, 'platform');
    if (!ended) throw new ConflictException({ code: 'already_ended', message: 'That session has already ended' });
    return { ended: true };
  }
}

@Module({ imports: [AuthModule, OpsModule, MfaModule], controllers: [SupportSessionController, SupportPlatformController], providers: [SupportService, PlatformGuard, PlatformTokens] })
export class SupportModule {}
