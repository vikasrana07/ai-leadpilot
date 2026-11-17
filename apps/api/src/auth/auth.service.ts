import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Prisma, type TxClient } from '@leadpilot/database';
import { industryChosen, type AuthContextResponse } from '@leadpilot/shared-types';
import type { AcceptInviteInput, LoginInput, RegisterInput } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { MfaService } from '../mfa/mfa.service.js';
import { MailService } from '../mail/mail.module.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { generateToken, hashToken } from './crypto.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;
const REFRESH_GRACE_MS = 10_000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface ClientMeta { ip: string | undefined; userAgent: string | undefined; requestId: string }

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  context: AuthContextResponse;
}

const INVALID_CREDENTIALS = { code: 'invalid_credentials', message: 'Invalid email or password' };

@Injectable()
export class AuthService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(ENV) private readonly env: Env,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  // ---------------------------------------------------------------- registration & verification
  async register(input: RegisterInput, meta: ClientMeta): Promise<IssuedSession | null> {
    // Hash first so response time is the same whether or not the email already exists.
    const passwordHash = await this.passwords.hash(input.password);
    const tenantId = uuidv7();
    const userId = uuidv7();
    try {
      await this.db.tenantTx({ tenantId, userId }, async (tx) => {
        await tx.user.create({ data: { id: userId, email: input.email, passwordHash, name: input.name } });
        const { ownerRoleId } = await this.tenants.bootstrap(tx, tenantId, { name: input.businessName, email: input.email, industry: input.industry });
        await tx.membership.create({ data: { tenantId, userId, roleId: ownerRoleId } });
        await this.startSignupPlan(tx, tenantId);
        await this.audit.record(tx, {
          tenantId, actorUserId: userId, action: 'auth.register', resourceType: 'tenant', resourceId: tenantId,
          requestId: meta.requestId, ip: meta.ip,
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.mail.sendAccountExists(input.email);
        return null; // controller returns the same generic response: no account enumeration
      }
      throw e;
    }
    await this.sendVerification(userId, input.email);
    return this.issueSession(userId, tenantId, meta);
  }

  /** New workspaces start on SIGNUP_PLAN. A paid plan starts as a trial with no payment method; `internal` is unmetered (self-hosted/dev). */
  private async startSignupPlan(tx: TxClient, tenantId: string): Promise<void> {
    if (this.env.SIGNUP_PLAN === 'internal') return;
    const plan = await tx.plan.findUnique({ where: { key: this.env.SIGNUP_PLAN } });
    if (!plan || !plan.active) throw new Error(`SIGNUP_PLAN "${this.env.SIGNUP_PLAN}" is not an active plan`);
    await tx.tenant.update({ where: { id: tenantId }, data: { planKey: plan.key } });
    await tx.subscription.create({ data: { tenantId, planKey: plan.key, status: plan.trialDays > 0 ? 'TRIALING' : 'EXPIRED', trialEndsAt: plan.trialDays > 0 ? new Date(Date.now() + plan.trialDays * 86_400_000) : new Date() } });
  }

  private async sendVerification(userId: string, email: string): Promise<void> {
    const { token, hash } = generateToken();
    await this.db.prisma.emailVerificationToken.create({ data: { userId, tokenHash: hash, expiresAt: new Date(Date.now() + VERIFY_TTL_MS) } });
    await this.mail.sendVerification(email, token);
  }

  async verifyEmail(token: string, meta: ClientMeta): Promise<void> {
    const row = await this.db.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException({ code: 'invalid_token', message: 'This link is invalid or has expired' });
    const claimed = await this.db.prisma.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new BadRequestException({ code: 'invalid_token', message: 'This link is invalid or has expired' });
    await this.db.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.recordStandalone({ tenantId: null, actorUserId: row.userId, action: 'auth.email_verified', requestId: meta.requestId, ip: meta.ip });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.db.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;
    await this.sendVerification(user.id, user.email);
  }

  // ---------------------------------------------------------------- login / refresh / logout
  async login(input: LoginInput, meta: ClientMeta): Promise<IssuedSession | { mfaRequired: true; challengeToken: string }> {
    const user = await this.db.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.recordStandalone({ tenantId: null, action: 'auth.login_failed', metadata: { reason: 'unknown_user' }, requestId: meta.requestId, ip: meta.ip });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    const locked = user.lockedUntil !== null && user.lockedUntil > new Date();
    const ok = !locked && user.status === 'ACTIVE' && (await this.passwords.verify(user.passwordHash, input.password));
    if (!ok) {
      if (!locked) await this.registerFailedLogin(user.id, user.failedLogins);
      await this.audit.recordStandalone({
        tenantId: null, actorUserId: user.id, action: 'auth.login_failed',
        metadata: { reason: locked ? 'locked' : user.status !== 'ACTIVE' ? 'disabled' : 'bad_password' }, requestId: meta.requestId, ip: meta.ip,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS); // identical for every failure mode
    }
    if (user.failedLogins > 0 || user.lockedUntil) await this.db.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    // Second factor: the password alone does not open a session for an account with MFA. The short-lived challenge proves step one passed.
    if (await this.mfa.isEnabled({ type: 'user', id: user.id })) return { mfaRequired: true, challengeToken: await this.mfa.signChallenge({ type: 'user', id: user.id }) };
    return this.finishLogin(user.id, meta);
  }

  /** Completes sign-in after MFA: verifies the challenge and the code, then issues the session exactly like a password-only login. */
  async loginWithMfa(challengeToken: string, proof: { code?: string | undefined; recoveryCode?: string | undefined }, meta: ClientMeta): Promise<IssuedSession> {
    const userId = await this.mfa.readChallenge(challengeToken, 'user');
    const user = await this.db.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'mfa_challenge_expired', message: 'Your sign-in expired. Sign in again.' });
    await this.mfa.verify({ type: 'user', id: user.id, label: user.email }, proof, meta.ip);
    return this.finishLogin(user.id, meta);
  }

  private async finishLogin(userId: string, meta: ClientMeta): Promise<IssuedSession> {
    const workspaces = await this.listWorkspaces(userId);
    const defaultTenant = workspaces[0]?.tenantId ?? null;
    const session = await this.issueSession(userId, defaultTenant, meta);
    if (defaultTenant) {
      await this.audit.recordStandalone({ tenantId: defaultTenant, actorUserId: userId, action: 'auth.login', requestId: meta.requestId, ip: meta.ip });
    }
    return session;
  }

  private async registerFailedLogin(userId: string, current: number): Promise<void> {
    const failed = current + 1;
    await this.db.prisma.user.update({
      where: { id: userId },
      data: failed >= MAX_FAILED_LOGINS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedLogins: failed },
    });
  }

  /** Creates a session (new rotation family) and returns tokens + the auth context. */
  async issueSession(userId: string, tenantId: string | null, meta: ClientMeta, familyId: string = uuidv7()): Promise<IssuedSession> {
    const { token, hash } = generateToken();
    const sessionId = uuidv7();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await this.db.prisma.session.create({
      data: { id: sessionId, userId, familyId, refreshTokenHash: hash, expiresAt: refreshExpiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
    });
    const accessToken = await this.tokens.signAccess({ userId, sessionId, tenantId });
    return { accessToken, refreshToken: token, refreshExpiresAt, context: await this.buildContext(userId, tenantId) };
  }

  /** Rotates the refresh token. Presenting an already-rotated token revokes the whole family (theft signal). */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<IssuedSession> {
    const session = await this.db.prisma.session.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException({ code: 'invalid_refresh', message: 'Session expired' });
    // Several tabs can refresh at the same instant with the same cookie. A token rotated moments ago is a race, not theft:
    // reject it harmlessly (the sibling tab already holds the new cookie). Reuse LONGER ago is treated as theft.
    if (session.rotatedAt !== null && Date.now() - session.rotatedAt.getTime() < REFRESH_GRACE_MS) {
      throw new UnauthorizedException({ code: 'refresh_race', message: 'Session was just refreshed' });
    }
    const claimed = await this.db.prisma.session.updateMany({ where: { id: session.id, rotatedAt: null }, data: { rotatedAt: new Date() } });
    if (session.rotatedAt !== null || claimed.count !== 1) {
      if (claimed.count !== 1 && session.rotatedAt === null) throw new UnauthorizedException({ code: 'refresh_race', message: 'Session was just refreshed' }); // lost the race by milliseconds
      await this.db.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.recordStandalone({
        tenantId: null, actorUserId: session.userId, action: 'auth.refresh_reuse_detected',
        metadata: { familyId: session.familyId }, requestId: meta.requestId, ip: meta.ip,
      });
      throw new UnauthorizedException({ code: 'invalid_refresh', message: 'Session expired' });
    }
    // Keep the workspace the user was in: re-derive only from memberships that are still active.
    const workspaces = await this.listWorkspaces(session.userId);
    const tenantId = workspaces[0]?.tenantId ?? null;
    return this.issueSession(session.userId, tenantId, meta, session.familyId);
  }

  async logout(sessionId: string, userId: string, tenantId: string | null, meta: ClientMeta): Promise<void> {
    const s = await this.db.prisma.session.findUnique({ where: { id: sessionId } });
    if (s) await this.db.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (tenantId) await this.audit.recordStandalone({ tenantId, actorUserId: userId, action: 'auth.logout', requestId: meta.requestId, ip: meta.ip });
  }

  async switchWorkspace(userId: string, sessionId: string, tenantId: string, meta: ClientMeta): Promise<{ accessToken: string; context: AuthContextResponse }> {
    const workspaces = await this.listWorkspaces(userId);
    if (!workspaces.some((w) => w.tenantId === tenantId)) throw new ForbiddenException({ code: 'workspace_access_denied', message: 'You do not have access to this workspace' });
    const accessToken = await this.tokens.signAccess({ userId, sessionId, tenantId });
    await this.audit.recordStandalone({ tenantId, actorUserId: userId, action: 'auth.workspace_switched', requestId: meta.requestId, ip: meta.ip });
    return { accessToken, context: await this.buildContext(userId, tenantId) };
  }

  // ---------------------------------------------------------------- password reset
  async forgotPassword(email: string): Promise<void> {
    const user = await this.db.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return; // always respond identically
    const { token, hash } = generateToken();
    await this.db.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    await this.mail.sendPasswordReset(user.email, token);
  }

  async resetPassword(token: string, password: string, meta: ClientMeta): Promise<void> {
    const row = await this.db.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException({ code: 'invalid_token', message: 'This link is invalid or has expired' });
    const claimed = await this.db.prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new BadRequestException({ code: 'invalid_token', message: 'This link is invalid or has expired' });
    const passwordHash = await this.passwords.hash(password);
    await this.db.prisma.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
    // Every existing session dies with the old password.
    await this.db.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.recordStandalone({ tenantId: null, actorUserId: row.userId, action: 'auth.password_reset', requestId: meta.requestId, ip: meta.ip });
  }

  // ---------------------------------------------------------------- sessions
  listSessions(userId: string, currentSessionId: string) {
    return this.db.prisma.session
      .findMany({ where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' }, select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true } })
      .then((rows) => rows.map((r) => ({ ...r, current: r.id === currentSessionId })));
  }

  async revokeSession(userId: string, sessionId: string, tenantId: string | null, meta: ClientMeta): Promise<void> {
    const s = await this.db.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw new NotFoundException({ code: 'not_found', message: 'Session not found' });
    await this.db.prisma.session.updateMany({ where: { familyId: s.familyId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (tenantId) await this.audit.recordStandalone({ tenantId, actorUserId: userId, action: 'auth.session_revoked', resourceType: 'session', resourceId: sessionId, requestId: meta.requestId, ip: meta.ip });
  }

  // ---------------------------------------------------------------- context
  async listWorkspaces(userId: string) {
    const rows = await this.db.userTx(userId, (tx) =>
      tx.membership.findMany({
        where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
        orderBy: { createdAt: 'asc' },
        select: { tenant: { select: { id: true, name: true, industryPackId: true, onboardingState: true } }, role: { select: { key: true, name: true } } },
      }),
    );
    return rows.map((m) => ({ tenantId: m.tenant.id, name: m.tenant.name, roleKey: m.role.key, roleName: m.role.name, industryPackId: m.tenant.industryPackId, industryChosen: industryChosen(m.tenant.onboardingState) }));
  }

  /** Name and industry pack of a workspace (support sessions have no membership to read them from). */
  async workspaceInfo(tenantId: string): Promise<{ name: string; industryPackId: string; industryChosen: boolean }> {
    const t = await this.db.tenantTx({ tenantId }, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, industryPackId: true, onboardingState: true } }));
    return { name: t.name, industryPackId: t.industryPackId, industryChosen: industryChosen(t.onboardingState) };
  }

  async buildContext(userId: string, activeTenantId: string | null): Promise<AuthContextResponse> {
    const user = await this.db.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const workspaces = await this.listWorkspaces(userId);
    const active = activeTenantId !== null && workspaces.some((w) => w.tenantId === activeTenantId) ? activeTenantId : null;
    let permissions: string[] = [];
    if (active) {
      const m = await this.db.tenantTx({ tenantId: active, userId }, (tx) =>
        tx.membership.findUnique({ where: { tenantId_userId: { tenantId: active, userId } }, select: { role: { select: { permissions: { select: { permissionKey: true } } } } } }),
      );
      permissions = m?.role.permissions.map((p) => p.permissionKey) ?? [];
    }
    return { user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerifiedAt !== null }, workspaces, activeTenantId: active, permissions };
  }

  // ---------------------------------------------------------------- invitations
  async previewInvitation(token: string) {
    const inv = await this.findInvitation(token);
    const info = await this.db.tenantTx({ tenantId: inv.tenant_id }, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: inv.tenant_id }, select: { name: true } });
      const role = await tx.role.findUnique({ where: { id: inv.role_id }, select: { name: true } });
      return { workspace: tenant?.name ?? '', role: role?.name ?? '' };
    });
    const existing = await this.db.prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
    return { email: inv.email, ...info, hasAccount: existing !== null };
  }

  private async findInvitation(token: string) {
    const rows = await this.db.userTx(null, (tx) =>
      tx.$queryRaw<{ id: string; tenant_id: string; email: string; role_id: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }[]>`
        SELECT * FROM find_invitation_by_token_hash(${hashToken(token)})`,
    );
    const inv = rows[0];
    if (!inv || inv.accepted_at || inv.revoked_at || inv.expires_at < new Date()) {
      throw new BadRequestException({ code: 'invalid_invitation', message: 'This invitation is invalid or has expired' });
    }
    return inv;
  }

  async acceptInvitation(input: AcceptInviteInput, authedUserId: string | undefined, meta: ClientMeta): Promise<IssuedSession> {
    const inv = await this.findInvitation(input.token);
    const existing = await this.db.prisma.user.findUnique({ where: { email: inv.email } });
    let userId: string;
    if (existing) {
      // An existing account must prove it is the invitee by being signed in as that user.
      if (authedUserId !== existing.id) throw new UnauthorizedException({ code: 'signin_required', message: `Sign in as ${inv.email} to accept this invitation` });
      userId = existing.id;
    } else {
      if (!input.name || !input.password) throw new BadRequestException({ code: 'account_details_required', message: 'Name and password are required' });
      userId = uuidv7();
      const passwordHash = await this.passwords.hash(input.password);
      try {
        await this.db.prisma.user.create({ data: { id: userId, email: inv.email, passwordHash, name: input.name, emailVerifiedAt: new Date() } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'account_exists', message: 'An account already exists for this email. Sign in to accept.' });
        throw e;
      }
    }
    await this.db.tenantTx({ tenantId: inv.tenant_id, userId }, async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException({ code: 'invalid_invitation', message: 'This invitation is invalid or has expired' });
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: inv.tenant_id, userId } },
        create: { tenantId: inv.tenant_id, userId, roleId: inv.role_id },
        update: { roleId: inv.role_id, status: 'ACTIVE' },
      });
      await this.audit.record(tx, { tenantId: inv.tenant_id, actorUserId: userId, action: 'team.invite_accepted', resourceType: 'invitation', resourceId: inv.id, requestId: meta.requestId, ip: meta.ip });
    });
    return this.issueSession(userId, inv.tenant_id, meta);
  }
}
