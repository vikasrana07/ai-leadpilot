import { Body, ConflictException, Controller, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, CurrentTenant, NoTenant, RequirePermissions } from '../common/decorators.js';
import type { AppRequest, AuthContext, TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';
import { MfaService, type MfaProof } from './mfa.service.js';

export const proofSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(), recoveryCode: z.string().trim().min(8).max(32).optional() }).refine((v) => !!v.code !== !!v.recoveryCode, 'Send either a code or a recovery code');
export const confirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const workspaceSchema = z.object({ requireMfa: z.boolean() });
const MFA_THROTTLE = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

/** Account-level two-step verification for the signed-in user. No workspace needed (a user locked out by a workspace policy must still be able to enrol). */
@NoTenant() @Controller('security/mfa')
export class MfaController {
  constructor(@Inject(MfaService) private readonly mfa: MfaService, @Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService) {}

  private async subject(a: AuthContext | undefined) {
    const u = await this.db.prisma.user.findUniqueOrThrow({ where: { id: (a as AuthContext).userId }, select: { id: true, email: true } });
    return { type: 'user' as const, id: u.id, label: u.email };
  }
  private async workspaceRequires(a: AuthContext | undefined): Promise<boolean> {
    if (!a?.activeTenantId) return false;
    const t = await this.db.tenantTx({ tenantId: a.activeTenantId, userId: a.userId }, (tx) => tx.tenant.findUnique({ where: { id: a.activeTenantId as string }, select: { settings: true } }));
    return (t?.settings as { requireMfa?: boolean } | null)?.requireMfa === true;
  }

  @Get() async status(@CurrentAuth() a: AuthContext | undefined) { return { ...(await this.mfa.status(await this.subject(a))), workspaceRequiresMfa: await this.workspaceRequires(a) }; }
  @Post('enroll') @HttpCode(200) async enroll(@CurrentAuth() a: AuthContext | undefined, @Req() req: AppRequest) { return this.mfa.startEnrollment(await this.subject(a), req.ip); }
  @Post('confirm') @HttpCode(200) @Throttle(MFA_THROTTLE) async confirm(@CurrentAuth() a: AuthContext | undefined, @Body(new ZodPipe(confirmSchema)) b: { code: string }, @Req() req: AppRequest) { return this.mfa.confirmEnrollment(await this.subject(a), b.code, req.ip); }
  @Post('recovery-codes') @HttpCode(200) @Throttle(MFA_THROTTLE) async regenerate(@CurrentAuth() a: AuthContext | undefined, @Body(new ZodPipe(proofSchema)) b: MfaProof, @Req() req: AppRequest) { return this.mfa.regenerateRecoveryCodes(await this.subject(a), b, req.ip); }

  @Post('disable') @HttpCode(204) @Throttle(MFA_THROTTLE)
  async disable(@CurrentAuth() a: AuthContext | undefined, @Body(new ZodPipe(proofSchema)) b: MfaProof, @Req() req: AppRequest): Promise<void> {
    // A workspace that requires MFA must not be left with a member who can switch it off (that would be a silent bypass).
    if (await this.workspaceRequires(a)) throw new ConflictException({ code: 'mfa_required_by_workspace', message: 'Your workspace requires two-step verification, so it cannot be turned off.' });
    await this.mfa.disable(await this.subject(a), b, req.ip);
  }
}

/** Owner-controlled policy: every member of this workspace must have two-step verification. Enforced in TenantGuard. */
@Controller('security/workspace')
export class WorkspaceSecurityController {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(MfaService) private readonly mfa: MfaService, @Inject(AuditService) private readonly audit: AuditService) {}

  @Get() async get(@CurrentTenant() c: TenantRequestContext) {
    const t = await this.db.tenantTx(c, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { settings: true } }));
    return { requireMfa: (t.settings as { requireMfa?: boolean } | null)?.requireMfa === true };
  }

  @Put() @RequirePermissions('settings:manage')
  async put(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(workspaceSchema)) b: z.infer<typeof workspaceSchema>) {
    // The person switching it on must already be protected themselves, or they would lock themselves out at once.
    if (b.requireMfa && !(await this.mfa.isEnabled({ type: 'user', id: c.userId }))) throw new ConflictException({ code: 'enroll_first', message: 'Set up two-step verification for your own account first, then require it for the workspace.' });
    await this.db.tenantTx(c, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { settings: true } });
      await tx.tenant.update({ where: { id: c.tenantId }, data: { settings: { ...((t.settings ?? {}) as Record<string, unknown>), requireMfa: b.requireMfa } } });
      await this.audit.record(tx, { tenantId: c.tenantId, actorUserId: c.userId, action: 'tenant.mfa_requirement_changed', resourceType: 'tenant', resourceId: c.tenantId, metadata: { requireMfa: b.requireMfa }, requestId: c.requestId, ip: c.ip });
    });
    return { requireMfa: b.requireMfa };
  }
}
