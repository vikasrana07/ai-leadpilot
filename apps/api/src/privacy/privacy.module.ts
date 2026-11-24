import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentTenant, RequirePermissions } from '../common/decorators.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DbService } from '../db/db.module.js';

const eraseSchema = z.object({ reason: z.string().trim().min(5, 'Record why (e.g. the data principal request reference)').max(300), confirm: z.literal('ERASE') });

/**
 * Data-principal rights (DPDP): access/export and erasure of everything held about one lead. These are workspace-owner tools;
 * erasure is irreversible, so it needs an explicit confirmation and a recorded reason, and the audit entry keeps only counts.
 */
@Injectable()
export class PrivacyService {
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(AuditService) private readonly audit: AuditService) {}

  async exportLead(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const ids = [id, ...(await tx.lead.findMany({ where: { tenantId: ctx.tenantId, mergedIntoId: id }, select: { id: true } })).map((l) => l.id)];
      const addresses = [...new Set((await tx.lead.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId }, select: { email: true } })).map((l) => l.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
      const convs = await tx.conversation.findMany({ where: { tenantId: ctx.tenantId, leadId: { in: ids } }, select: { id: true, createdAt: true } });
      const data = {
        exportedAt: new Date().toISOString(), subject: { leadId: id },
        lead, mergedDuplicates: ids.slice(1),
        notes: await tx.leadNote.findMany({ where: { leadId: { in: ids } } }),
        activities: await tx.leadActivity.findMany({ where: { leadId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
        consents: await tx.consent.findMany({ where: { leadId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
        scores: await tx.leadScore.findMany({ where: { leadId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
        appointments: await tx.appointment.findMany({ where: { leadId: { in: ids } }, orderBy: { startsAt: 'asc' } }),
        tasks: await tx.task.findMany({ where: { leadId: { in: ids } } }),
        // Email tracking (S-20): every email sent to this person, linked to the lead or only by address, with what the tracking pixel and links recorded.
        emails: await tx.trackedEmail.findMany({
          where: { tenantId: ctx.tenantId, OR: [{ leadId: { in: ids } }, ...(addresses.length ? [{ recipient: { in: addresses } }] : [])] },
          orderBy: { createdAt: 'asc' },
          include: { events: { orderBy: { timestamp: 'asc' }, select: { type: true, timestamp: true, ipAddress: true, userAgent: true, clickUrl: true } } },
        }),
        emailSuppressions: addresses.length ? await tx.emailSuppression.findMany({ where: { tenantId: ctx.tenantId, email: { in: addresses } }, select: { email: true, reason: true, source: true, createdAt: true } }) : [],
        conversations: [] as { id: string; startedAt: Date; messages: unknown[] }[],
      };
      for (const c of convs) data.conversations.push({ id: c.id, startedAt: c.createdAt, messages: await tx.message.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'asc' }, select: { id: true, direction: true, senderType: true, type: true, body: true, status: true, createdAt: true } }) });
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'privacy.lead_exported', resourceType: 'lead', resourceId: id, metadata: { messages: data.conversations.reduce((n, c) => n + c.messages.length, 0) }, requestId: ctx.requestId, ip: ctx.ip });
      return data;
    });
  }

  async eraseLead(ctx: TenantRequestContext, id: string, reason: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const rows = await tx.$queryRaw<{ r: Record<string, number> | null }[]>`SELECT erase_lead(${ctx.tenantId}::uuid, ${id}::uuid) AS r`;
      const counts = rows[0]?.r;
      if (!counts) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      // The audit trail keeps THAT an erasure happened (id, who, why, counts), never the erased content.
      await this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'privacy.lead_erased', resourceType: 'lead', resourceId: id, metadata: { reason, counts }, requestId: ctx.requestId, ip: ctx.ip });
      return { erased: true, counts };
    });
  }
}

@Controller('privacy')
class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly svc: PrivacyService) {}
  @Get('leads/:id/export') @RequirePermissions('lead:export', 'lead:read:all') export(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.svc.exportLead(c, id); }
  @Post('leads/:id/erase') @HttpCode(200) @RequirePermissions('lead:delete', 'lead:read:all') erase(@CurrentTenant() c: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(eraseSchema)) b: z.infer<typeof eraseSchema>) { return this.svc.eraseLead(c, id, b.reason); }
}

@Module({ controllers: [PrivacyController], providers: [PrivacyService] })
export class PrivacyModule {}
