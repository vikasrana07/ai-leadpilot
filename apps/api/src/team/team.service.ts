import { EntitlementsService } from '../billing/entitlements.service.js';
import { SessionCacheService } from '../common/session-cache.js';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isPermissionKey, SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from '@leadpilot/shared-types';
import { resolveEffectivePermissions } from '../common/permissions.util.js';
import type { InviteInput } from '@leadpilot/validation';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { generateToken } from '../auth/crypto.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { DbService } from '../db/db.module.js';
import { MailService } from '../mail/mail.module.js';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

@Injectable()
export class TeamService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(EntitlementsService) private readonly ent: EntitlementsService,
    @Inject(SessionCacheService) private readonly sessionCache: SessionCacheService,
  ) {}

  /** Privilege-escalation guard: you can only grant a role whose permissions you hold yourself. */
  private async assertCanGrantRole(tx: Parameters<Parameters<DbService['tenantTx']>[1]>[0], ctx: TenantRequestContext, roleKey: string): Promise<void> {
    let perms: readonly string[];
    if (roleKey in SYSTEM_ROLES) {
      perms = SYSTEM_ROLES[roleKey as SystemRoleKey].permissions;
    } else {
      const role = await tx.role.findUnique({
        where: { tenantId_key: { tenantId: ctx.tenantId, key: roleKey } },
        include: { permissions: true },
      });
      if (!role) throw new NotFoundException({ code: 'role_not_found', message: 'Role not found' });
      perms = role.permissions.map((p) => p.permissionKey);
    }
    const missing = perms.some((p) => !ctx.permissions.has(p as PermissionKey));
    if (missing) throw new ForbiddenException({ code: 'cannot_grant_role', message: 'You cannot assign a role with more permissions than your own' });
  }

  listMembers(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => {
      const rows = await tx.membership.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, createdAt: true, userId: true, role: { select: { key: true, name: true } } },
      });
      const users = await this.db.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, email: true, emailVerifiedAt: true } });
      const byId = new Map(users.map((u) => [u.id, u]));
      const enrolled = new Set((await this.db.prisma.mfaCredential.findMany({ where: { subjectType: 'user', subjectId: { in: rows.map((r) => r.userId) }, confirmedAt: { not: null } }, select: { subjectId: true } })).map((c) => c.subjectId));
      return rows.map((r) => ({
        mfaEnabled: enrolled.has(r.userId),
        id: r.id, status: r.status, joinedAt: r.createdAt, roleKey: r.role.key, roleName: r.role.name,
        user: { id: r.userId, name: byId.get(r.userId)?.name ?? '', email: byId.get(r.userId)?.email ?? '' },
      }));
    });
  }

  listInvitations(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, (tx) =>
      tx.invitation.findMany({
        where: { tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, expiresAt: true, createdAt: true, role: { select: { key: true, name: true } } },
      }),
    );
  }

  async invite(ctx: TenantRequestContext, input: InviteInput) {
    const inviter = await this.db.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true, emailVerifiedAt: true } });
    if (!inviter.emailVerifiedAt) throw new ForbiddenException({ code: 'email_unverified', message: 'Verify your email before inviting teammates' });
    await this.ent.assertCanAdd(ctx.tenantId, 'seats', 'team seats (members plus pending invitations)');
    const target = await this.db.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const { token, hash } = generateToken();
    const result = await this.db.tenantTx(ctx, async (tx) => {
      await this.assertCanGrantRole(tx, ctx, input.roleKey);
      if (target) {
        const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId: target.id } } });
        if (m?.status === 'ACTIVE') throw new ConflictException({ code: 'already_member', message: 'This person is already on your team' });
      }
      const role = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: ctx.tenantId, key: input.roleKey } } });
      await tx.invitation.updateMany({ where: { tenantId: ctx.tenantId, email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const inv = await tx.invitation.create({
        data: { id: uuidv7(), tenantId: ctx.tenantId, email: input.email, roleId: role.id, tokenHash: hash, invitedBy: ctx.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'team.invited', resourceType: 'invitation', resourceId: inv.id, metadata: { roleKey: input.roleKey }, requestId: ctx.requestId, ip: ctx.ip });
      return { id: inv.id, workspace: tenant.name };
    });
    await this.mail.sendInvitation(input.email, token, result.workspace, inviter.name);
    return { id: result.id, email: input.email, roleKey: input.roleKey };
  }

  revokeInvitation(ctx: TenantRequestContext, id: string): Promise<void> {
    return this.db.tenantTx(ctx, async (tx) => {
      const r = await tx.invitation.updateMany({ where: { id, tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'Invitation not found' });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'team.invite_revoked', resourceType: 'invitation', resourceId: id, requestId: ctx.requestId, ip: ctx.ip });
    });
  }

  private async assertNotLastOwner(tx: Parameters<Parameters<DbService['tenantTx']>[1]>[0], ctx: TenantRequestContext, membershipId: string): Promise<void> {
    const owners = await tx.membership.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE', role: { key: 'owner' } } });
    const target = await tx.membership.findUnique({ where: { id: membershipId }, select: { status: true, role: { select: { key: true } } } });
    if (target?.role.key === 'owner' && target.status === 'ACTIVE' && owners <= 1) {
      throw new BadRequestException({ code: 'last_owner', message: 'A workspace must keep at least one active owner' });
    }
  }

  changeRole(ctx: TenantRequestContext, membershipId: string, roleKey: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      await this.assertCanGrantRole(tx, ctx, roleKey);
      const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId }, select: { id: true, userId: true, role: { select: { key: true } } } });
      if (!m) throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      if (m.userId === ctx.userId) throw new BadRequestException({ code: 'self_change', message: 'You cannot change your own role' });
      // Changing someone who currently outranks you is also escalation-adjacent: require holding their role's permissions.
      await this.assertCanGrantRole(tx, ctx, m.role.key);
      await this.assertNotLastOwner(tx, ctx, membershipId);
      const role = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: ctx.tenantId, key: roleKey } } });
      await tx.membership.update({ where: { id: membershipId }, data: { roleId: role.id } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'team.role_changed', resourceType: 'membership', resourceId: membershipId, metadata: { from: m.role.key, to: roleKey }, requestId: ctx.requestId, ip: ctx.ip });
      return { id: membershipId, roleKey };
    });
  }

  async changeStatus(ctx: TenantRequestContext, membershipId: string, status: 'ACTIVE' | 'DEACTIVATED') {
    if (status === 'ACTIVE') await this.ent.assertCanAdd(ctx.tenantId, 'seats', 'team seats (members plus pending invitations)');
    return this.db.tenantTx(ctx, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId }, select: { id: true, userId: true, role: { select: { key: true } } } });
      if (!m) throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      if (m.userId === ctx.userId) throw new BadRequestException({ code: 'self_change', message: 'You cannot change your own status' });
      await this.assertCanGrantRole(tx, ctx, m.role.key);
      if (status === 'DEACTIVATED') {
        await this.assertNotLastOwner(tx, ctx, membershipId);
        await this.sessionCache.invalidateUser(m.userId);
      }
      await tx.membership.update({ where: { id: membershipId }, data: { status } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'team.member_status_changed', resourceType: 'membership', resourceId: membershipId, metadata: { status }, requestId: ctx.requestId, ip: ctx.ip });
      return { id: membershipId, status };
    });
  }

  /**
   * Lost-phone recovery: a workspace admin removes a teammate's two-step verification so they can sign in and enrol again.
   * Guards: same rank rule as role changes, never yourself, only when this is the person's only workspace (MFA is account-wide, so
   * otherwise another workspace's protection would be removed by a stranger), reason required, sessions revoked, person emailed, audited.
   */
  async resetMemberMfa(ctx: TenantRequestContext, membershipId: string, reason: string) {
    const target = await this.db.tenantTx(ctx, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId }, select: { userId: true, role: { select: { key: true } } } });
      if (!m) throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      if (m.userId === ctx.userId) throw new BadRequestException({ code: 'self_change', message: 'Use the Security page to change your own two-step verification' });
      await this.assertCanGrantRole(tx, ctx, m.role.key);
      return m;
    });
    const subject = { subjectType: 'user', subjectId: target.userId };
    const cred = await this.db.prisma.mfaCredential.findUnique({ where: { subjectType_subjectId: subject }, select: { confirmedAt: true } });
    if (!cred?.confirmedAt) throw new ConflictException({ code: 'mfa_not_enabled', message: 'This person has not turned on two-step verification' });
    const counted = await this.db.prisma.$queryRaw<{ n: number }[]>`SELECT user_active_workspace_count(${target.userId}::uuid) AS n`;
    const n = counted[0]?.n ?? 2; // fail safe: if the count is unknown, refuse
    if (n > 1) throw new ConflictException({ code: 'user_in_other_workspaces', message: 'This person also belongs to another workspace, so their two-step verification can only be reset by them (recovery code) or by LeadPilot support.' });
    const user = await this.db.prisma.user.findUniqueOrThrow({ where: { id: target.userId }, select: { email: true } });
    await this.db.prisma.$transaction([
      this.db.prisma.mfaRecoveryCode.deleteMany({ where: subject }),
      this.db.prisma.mfaCredential.delete({ where: { subjectType_subjectId: subject } }),
      this.db.prisma.session.updateMany({ where: { userId: target.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.sessionCache.invalidateUser(target.userId);
    await this.db.tenantTx(ctx, (tx) => this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'team.mfa_reset', resourceType: 'membership', resourceId: membershipId, metadata: { reason }, requestId: ctx.requestId, ip: ctx.ip }));
    await this.mail.sendMfaReset(user.email);
    return { id: membershipId, mfaEnabled: false };
  }

  async getMemberPermissions(ctx: TenantRequestContext, membershipId: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId },
        include: {
          role: { select: { key: true, name: true, permissions: { select: { permissionKey: true } } } },
          permissionOverrides: { select: { permissionKey: true, effect: true } },
        },
      });
      if (!m) throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      const rolePermissions = m.role.permissions.map((p) => p.permissionKey);
      const effectivePermissions = [...resolveEffectivePermissions(rolePermissions, m.permissionOverrides)];
      return {
        membershipId: m.id,
        roleKey: m.role.key,
        roleName: m.role.name,
        rolePermissions,
        overrides: m.permissionOverrides,
        effectivePermissions,
      };
    });
  }

  async setMemberPermissions(
    ctx: TenantRequestContext,
    membershipId: string,
    overrides: { permissionKey: string; effect: 'GRANT' | 'REVOKE' }[],
  ) {
    if (membershipId === ctx.membershipId) {
      throw new ForbiddenException({ code: 'cannot_edit_self', message: 'You cannot override your own permissions' });
    }
    const invalid = overrides.filter((o) => !isPermissionKey(o.permissionKey));
    if (invalid.length) {
      throw new BadRequestException({ code: 'invalid_permissions', message: `Unknown permission key: ${invalid[0]?.permissionKey}` });
    }
    const missing = overrides.filter((o) => !ctx.permissions.has(o.permissionKey as PermissionKey));
    if (missing.length) {
      throw new ForbiddenException({
        code: 'cannot_grant_permissions',
        message: 'You cannot override permissions that you do not hold',
      });
    }

    return this.db.tenantTx(ctx, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId },
        include: { role: { select: { key: true, name: true, permissions: { select: { permissionKey: true } } } } },
      });
      if (!m) throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      if (m.role.key === 'owner') {
        throw new ForbiddenException({ code: 'owner_immutable', message: 'Owner permissions cannot be overridden' });
      }

      const roleSet = new Set(m.role.permissions.map((p) => p.permissionKey));
      // Deduplicate & drop no-op overrides (e.g. GRANT when role already has it, REVOKE when role doesn't)
      const dedup = new Map<string, 'GRANT' | 'REVOKE'>();
      for (const o of overrides) {
        if (o.effect === 'GRANT' && roleSet.has(o.permissionKey)) continue;
        if (o.effect === 'REVOKE' && !roleSet.has(o.permissionKey)) continue;
        dedup.set(o.permissionKey, o.effect);
      }

      await tx.memberPermissionOverride.deleteMany({ where: { tenantId: ctx.tenantId, membershipId: m.id } });
      if (dedup.size > 0) {
        await tx.memberPermissionOverride.createMany({
          data: [...dedup.entries()].map(([permissionKey, effect]) => ({
            tenantId: ctx.tenantId,
            membershipId: m.id,
            permissionKey,
            effect,
          })),
        });
      }

      const cleanOverrides = [...dedup.entries()].map(([permissionKey, effect]) => ({ permissionKey, effect }));
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'team.member_permissions_updated',
        resourceType: 'membership',
        resourceId: m.id,
        metadata: { overrides: cleanOverrides },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });

      return {
        membershipId: m.id,
        roleKey: m.role.key,
        roleName: m.role.name,
        rolePermissions: [...roleSet],
        overrides: cleanOverrides,
        effectivePermissions: [...resolveEffectivePermissions([...roleSet], cleanOverrides)],
      };
    });
  }
}
