import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@leadpilot/database';
import type { Response } from 'express';
import { z } from 'zod';
import { OBJECT_STORAGE, type ObjectStorage } from '../ai/knowledge/storage.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { BillingExempt } from '../common/billing-meta.js';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';
import { LifecycleJobs, effectiveRetention } from '../ops/lifecycle-jobs.js';
import { OpsModule } from '../ops/ops.module.js';
import { BillingNotifier } from '../ops/billing-notify.js';
import { PlatformGuard, PlatformTokens, type PlatformRequest } from '../platform/platform-auth.js';

const day = (min: number) => z.number().int().min(min).max(3650);
const retentionSchema = z.object({ webhookPayloadDays: day(1), softDeletedLeadDays: day(1), closedConversationDays: day(1).nullable(), auditLogDays: day(1).nullable(), automationDryRunDays: day(1).optional(), automationRunDays: day(1).optional(), automationVersionDays: day(1).optional() });
const deletionSchema = z.object({ reason: z.string().trim().min(5).max(500), confirm: z.literal('DELETE WORKSPACE'), password: z.string().min(1).max(128) });
const STRICT = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 5), ttl: 60_000 } };

function assertOwner(c: TenantRequestContext): void {
  if (c.roleKey !== 'owner') throw new ForbiddenException({ code: 'forbidden', message: 'Only a workspace owner can do this' });
}

@Injectable()
export class LifecycleService {
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env, @Inject(AuditService) private readonly audit: AuditService, @Inject(LifecycleJobs) private readonly jobs: LifecycleJobs,
    @Inject(PasswordService) private readonly passwords: PasswordService, @Inject(ModuleRef) private readonly moduleRef: ModuleRef, @Inject(EntitlementsService) private readonly ent: EntitlementsService,
    @Inject(BillingNotifier) private readonly notifier: BillingNotifier,
  ) {}

  // ------------------------------------------------------------------ retention
  async getRetention(c: TenantRequestContext) {
    const t = await this.db.tenantTx(c, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { settings: true } }));
    return { settings: effectiveRetention(t.settings, this.env), minDays: this.env.RETENTION_MIN_DAYS, defaults: { webhookPayloadDays: this.env.RETENTION_WEBHOOK_PAYLOAD_DAYS, softDeletedLeadDays: this.env.RETENTION_SOFT_DELETED_LEAD_DAYS, closedConversationDays: null, auditLogDays: null, automationDryRunDays: this.env.RETENTION_AUTOMATION_DRY_RUN_DAYS, automationRunDays: this.env.RETENTION_AUTOMATION_RUN_DAYS, automationVersionDays: this.env.RETENTION_AUTOMATION_VERSION_DAYS } };
  }

  async saveRetention(c: TenantRequestContext, input: z.infer<typeof retentionSchema>) {
    const min = this.env.RETENTION_MIN_DAYS;
    for (const [k, v] of Object.entries(input)) if (typeof v === 'number' && v < min) throw new ZodPipeError(k, `The shortest period allowed is ${min} days`);
    await this.db.tenantTx(c, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { settings: true } });
      const settings = (t.settings ?? {}) as Record<string, unknown>;
      // merge, so the optional automation overrides (no UI yet) survive a save from the privacy page that does not send them
      const prior = (settings.retention ?? {}) as Record<string, unknown>;
      await tx.tenant.update({ where: { id: c.tenantId }, data: { settings: { ...settings, retention: { ...prior, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } } as Prisma.InputJsonObject } });
      await this.audit.record(tx, { tenantId: c.tenantId, actorUserId: c.userId, action: 'privacy.retention_changed', resourceType: 'tenant', resourceId: c.tenantId, metadata: { ...input }, requestId: c.requestId, ip: c.ip });
    });
    return this.getRetention(c);
  }

  previewRetention(c: TenantRequestContext) { return this.jobs.runRetention(c.tenantId, { dry: true }); }

  // ------------------------------------------------------------------ workspace export
  async listExports(c: TenantRequestContext) {
    assertOwner(c);
    const rows = await this.db.tenantTx(c, (tx) => tx.dataExport.findMany({ where: { tenantId: c.tenantId }, orderBy: { createdAt: 'desc' }, take: 10 }));
    return rows.map((e) => ({ id: e.id, status: e.status, sizeBytes: e.sizeBytes === null ? null : Number(e.sizeBytes), error: e.error, createdAt: e.createdAt.toISOString(), completedAt: e.completedAt?.toISOString() ?? null, expiresAt: e.expiresAt?.toISOString() ?? null }));
  }

  async requestExport(c: TenantRequestContext) {
    assertOwner(c);
    try {
      return await this.db.tenantTx(c, async (tx) => {
        const e = await tx.dataExport.create({ data: { tenantId: c.tenantId, requestedByUserId: c.userId } });
        await this.audit.record(tx, { tenantId: c.tenantId, actorUserId: c.userId, action: 'privacy.workspace_export_requested', resourceType: 'data_export', resourceId: e.id, requestId: c.requestId, ip: c.ip });
        return { id: e.id, status: e.status };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'export_in_progress', message: 'An export is already being prepared. Wait for it to finish.' });
      throw e;
    }
  }

  async download(c: TenantRequestContext, id: string, res: Response) {
    assertOwner(c);
    const e = await this.db.tenantTx(c, (tx) => tx.dataExport.findFirst({ where: { id, tenantId: c.tenantId } }));
    if (!e) throw new NotFoundException({ code: 'not_found', message: 'Export not found' });
    if (e.status !== 'READY' || !e.storageKey || (e.expiresAt && e.expiresAt < new Date())) throw new NotFoundException({ code: 'export_unavailable', message: 'This export is not available (it may have expired). Request a new one.' });
    const data = await this.moduleRef.get<ObjectStorage>(OBJECT_STORAGE, { strict: false }).get(e.storageKey);
    await this.db.tenantTx(c, (tx) => this.audit.record(tx, { tenantId: c.tenantId, actorUserId: c.userId, action: 'privacy.workspace_export_downloaded', resourceType: 'data_export', resourceId: id, requestId: c.requestId, ip: c.ip }));
    res.set({ 'Content-Type': 'application/gzip', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="workspace-export-${id.slice(0, 8)}.json.gz"`, 'Cache-Control': 'private, no-store' });
    res.send(data);
  }

  // ------------------------------------------------------------------ workspace deletion
  async deletionState(c: TenantRequestContext) {
    const r = await this.db.tenantTx(c, (tx) => tx.tenantDeletionRequest.findFirst({ where: { tenantId: c.tenantId, status: 'PENDING' } }));
    return { pending: r !== null, requestedAt: r?.requestedAt.toISOString() ?? null, purgeAfter: r?.purgeAfter.toISOString() ?? null, coolingOffDays: this.env.DELETION_COOLING_OFF_DAYS };
  }

  async requestDeletion(c: TenantRequestContext, input: z.infer<typeof deletionSchema>) {
    assertOwner(c);
    // Re-authentication: this is the most destructive thing an owner can do.
    const user = await this.db.prisma.user.findUnique({ where: { id: c.userId }, select: { passwordHash: true } });
    if (!user || !(await this.passwords.verify(user.passwordHash, input.password))) throw new UnauthorizedException({ code: 'invalid_password', message: 'That password is not correct' });
    const purgeAfter = new Date(Date.now() + this.env.DELETION_COOLING_OFF_DAYS * 86_400_000);
    try {
      await this.db.tenantTx(c, async (tx) => {
        const r = await tx.tenantDeletionRequest.create({ data: { tenantId: c.tenantId, requestedByUserId: c.userId, reason: input.reason, purgeAfter } });
        await this.audit.record(tx, { tenantId: c.tenantId, actorUserId: c.userId, action: 'privacy.deletion_requested', resourceType: 'tenant', resourceId: r.id, metadata: { purgeAfter: purgeAfter.toISOString(), reason: input.reason }, requestId: c.requestId, ip: c.ip });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'deletion_pending', message: 'Deletion is already scheduled for this workspace.' });
      throw e;
    }
    this.ent.invalidate(c.tenantId);
    await this.notifier.notifyOwners(c.tenantId, { type: 'privacy', title: 'Workspace deletion scheduled', body: `All data will be permanently deleted on ${purgeAfter.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. You can cancel until then.`, link: '/settings', email: { subject: 'Your LeadPilot workspace is scheduled for deletion', text: `An owner requested deletion of your workspace. It is read-only now and all data will be permanently deleted on ${purgeAfter.toISOString().slice(0, 10)}. Export your data and cancel anytime before then in Settings.` } }).catch(() => undefined);
    return this.deletionState(c);
  }

  async cancelDeletion(c: TenantRequestContext) {
    assertOwner(c);
    await this.db.tenantTx(c, async (tx) => {
      const r = await tx.tenantDeletionRequest.updateMany({ where: { tenantId: c.tenantId, status: 'PENDING' }, data: { status: 'CANCELED', canceledAt: new Date() } });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'No deletion is scheduled' });
      await this.audit.record(tx, { tenantId: c.tenantId, actorUserId: c.userId, action: 'privacy.deletion_canceled', resourceType: 'tenant', resourceId: c.tenantId, requestId: c.requestId, ip: c.ip });
    });
    this.ent.invalidate(c.tenantId);
    return this.deletionState(c);
  }

  async platformRequests() {
    const rows = await this.db.prisma.$queryRaw<{ id: string; tenant_id: string; tenant_name: string; tenant_email: string; reason: string; requested_at: Date; purge_after: Date }[]>`SELECT * FROM platform_deletion_requests()`;
    return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, tenantEmail: r.tenant_email, reason: r.reason, requestedAt: r.requested_at.toISOString(), purgeAfter: r.purge_after.toISOString() }));
  }
}

class ZodPipeError extends BadRequestException {
  constructor(path: string, message: string) { super({ code: 'validation_error', message: 'Invalid request', details: [{ path, message }] }); }
}

/** Data lifecycle controls stay reachable in a read-only (lapsed or pending-deletion) workspace: that is exactly when they are needed. */
@Controller('privacy') @BillingExempt()
class LifecycleController {
  constructor(@Inject(LifecycleService) private readonly svc: LifecycleService) {}

  @Get('retention') @RequirePermissions('settings:manage') retention(@CurrentTenant() c: TenantRequestContext) { return this.svc.getRetention(c); }
  @Put('retention') @RequirePermissions('settings:manage') save(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(retentionSchema)) b: z.infer<typeof retentionSchema>) { return this.svc.saveRetention(c, b); }
  @Post('retention/preview') @HttpCode(200) @RequirePermissions('settings:manage') preview(@CurrentTenant() c: TenantRequestContext) { return this.svc.previewRetention(c); }

  @Get('exports') @RequirePermissions('settings:manage') exports(@CurrentTenant() c: TenantRequestContext) { return this.svc.listExports(c); }
  @Post('exports') @HttpCode(202) @RequirePermissions('settings:manage') request(@CurrentTenant() c: TenantRequestContext) { return this.svc.requestExport(c); }
  @Get('exports/:id/download') @RequirePermissions('settings:manage') download(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) { return this.svc.download(c, id, res); }

  @Get('workspace/deletion') @RequirePermissions('settings:manage') state(@CurrentTenant() c: TenantRequestContext) { return this.svc.deletionState(c); }
  @Post('workspace/deletion') @HttpCode(200) @Throttle(STRICT) @RequirePermissions('settings:manage') requestDeletion(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(deletionSchema)) b: z.infer<typeof deletionSchema>) { return this.svc.requestDeletion(c, b); }
  @Post('workspace/deletion/cancel') @HttpCode(200) @RequirePermissions('settings:manage') cancel(@CurrentTenant() c: TenantRequestContext) { return this.svc.cancelDeletion(c); }
}

/** Platform console view of pending deletions (same separate auth as the rest of the console). */
@Public() @Controller('platform/deletion-requests')
class PlatformDeletionController {
  constructor(@Inject(LifecycleService) private readonly svc: LifecycleService) {}
  @UseGuards(PlatformGuard) @Get() list(@Query() _q: unknown) { return this.svc.platformRequests(); }
}

export type { PlatformRequest };
@Module({ imports: [OpsModule, AuthModule], controllers: [LifecycleController, PlatformDeletionController], providers: [LifecycleService, PlatformGuard, PlatformTokens] })
export class LifecycleModule {}
