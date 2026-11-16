import { EntitlementsService } from '../billing/entitlements.service.js';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SYSTEM_ROLES, type SystemRoleKey } from '@leadpilot/shared-types';
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
  ) {}

  /** Privilege-escalation guard: you can only grant a role whose permissions you hold yourself. */
  private assertCanGrant(ctx: TenantRequestContext, roleKey: SystemRoleKey): void {
    const missing = SYSTEM_ROLES[roleKey].permissions.some((p) => !ctx.permissions.has(p));
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
      return rows.map((r) => ({
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
    this.assertCanGrant(ctx, input.roleKey);
    await this.ent.assertCanAdd(ctx.tenantId, 'seats', 'team seats (members plus pending invitations)');
    const target = await this.db.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const { token, hash } = generateToken();
    const result = await this.db.tenantTx(ctx, async (tx) => {
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

  changeRole(ctx: TenantRequestContext, membershipId: string, roleKey: SystemRoleKey) {
    this.assertCanGrant(ctx, roleKey);
    return this.db.tenantTx(ctx, async (tx) => {
      const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId }, select: { id: true, userId: true, role: { select: { key: true } } } });
      if (!m) throw new NotFoundException({ code: 'not_found', message: 'Member not found' });
      if (m.userId === ctx.userId) throw new BadRequestException({ code: 'self_change', message: 'You cannot change your own role' });
      // Changing someone who currently outranks you is also escalation-adjacent: require holding their role's permissions.
      this.assertCanGrant(ctx, m.role.key as SystemRoleKey);
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
      this.assertCanGrant(ctx, m.role.key as SystemRoleKey);
      if (status === 'DEACTIVATED') await this.assertNotLastOwner(tx, ctx, membershipId);
      await tx.membership.update({ where: { id: membershipId }, data: { status } });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'team.member_status_changed', resourceType: 'membership', resourceId: membershipId, metadata: { status }, requestId: ctx.requestId, ip: ctx.ip });
      return { id: membershipId, status };
    });
  }
}
