import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import crypto from 'node:crypto';
import type { Actor } from '../../common/actor.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { ENV } from '../../common/tokens.js';
import type { Env } from '../../config/env.js';
import { DbService } from '../../db/db.module.js';
import { LeadsService } from '../../leads/leads.service.js';
import { parsePortalEmail } from './parsers.js';

@Injectable()
export class PortalEmailService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private newKey(): string {
    return `pe_${crypto.randomBytes(18).toString('base64url')}`;
  }

  private view(cfg: { webhookKey: string; enabled: boolean } | null) {
    return {
      configured: cfg !== null,
      enabled: cfg?.enabled ?? false,
      webhookUrl: cfg ? `${this.env.WEB_ORIGIN.replace(/\/$/, '')}/api-proxy-or-direct` : null,
      endpointPath: cfg ? `/webhooks/portal-email/${cfg.webhookKey}` : null,
    };
  }

  async getConfig(ctx: TenantRequestContext) {
    const cfg = await this.db.tenantTx(ctx, (tx) =>
      tx.portalEmailConfig.findUnique({ where: { tenantId: ctx.tenantId } }),
    );
    return {
      configured: cfg !== null,
      enabled: cfg?.enabled ?? false,
      endpointPath: cfg ? `/webhooks/portal-email/${cfg.webhookKey}` : null,
    };
  }

  async saveConfig(ctx: TenantRequestContext, enabled: boolean) {
    const cfg = await this.db.tenantTx(ctx, async (tx) => {
      const existing = await tx.portalEmailConfig.findUnique({ where: { tenantId: ctx.tenantId } });
      return existing
        ? tx.portalEmailConfig.update({ where: { tenantId: ctx.tenantId }, data: { enabled } })
        : tx.portalEmailConfig.create({ data: { tenantId: ctx.tenantId, webhookKey: this.newKey(), enabled } });
    });
    return { configured: true, enabled: cfg.enabled, endpointPath: `/webhooks/portal-email/${cfg.webhookKey}` };
  }

  async rotateKey(ctx: TenantRequestContext) {
    const cfg = await this.db.tenantTx(ctx, async (tx) => {
      const existing = await tx.portalEmailConfig.findUnique({ where: { tenantId: ctx.tenantId } });
      if (!existing) {
        return tx.portalEmailConfig.create({ data: { tenantId: ctx.tenantId, webhookKey: this.newKey(), enabled: true } });
      }
      return tx.portalEmailConfig.update({ where: { tenantId: ctx.tenantId }, data: { webhookKey: this.newKey() } });
    });
    return { configured: true, enabled: cfg.enabled, endpointPath: `/webhooks/portal-email/${cfg.webhookKey}` };
  }

  async logs(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, (tx) =>
      tx.portalEmailLog.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    );
  }

  async ingest(webhookKey: string, payload: Record<string, unknown>) {
    // Resolve tenant by webhookKey outside RLS (unauthenticated inbound webhook)
    const row = (
      await this.db.userTx(null, (tx) =>
        tx.$queryRaw<{ id: string; tenant_id: string; webhook_key: string; enabled: boolean }[]>`SELECT * FROM find_portal_email_by_key(${webhookKey})`,
      )
    )[0];
    const cfg = row ? { id: row.id, tenantId: row.tenant_id, webhookKey: row.webhook_key, enabled: row.enabled } : null;
    if (!cfg || !cfg.enabled) {
      throw new NotFoundException({ code: 'not_found', message: 'Portal email endpoint not found' });
    }

    // Support Amazon SES SNS Notification wrapper as well as direct JSON email payload
    let emailObj = payload;
    if (payload.Type === 'Notification' && typeof payload.Message === 'string') {
      try {
        emailObj = JSON.parse(payload.Message) as Record<string, unknown>;
      } catch {
        emailObj = payload;
      }
    }

    const sender = String(emailObj.from ?? emailObj.sender ?? 'unknown@portal');
    const subject = String(emailObj.subject ?? 'Portal Lead');
    const text = typeof emailObj.text === 'string' ? emailObj.text : typeof emailObj.body === 'string' ? emailObj.body : undefined;
    const html = typeof emailObj.html === 'string' ? emailObj.html : undefined;

    const parsed = parsePortalEmail({
      sender,
      subject,
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
    });
    if (!parsed) {
      await this.db.tenantTx({ tenantId: cfg.tenantId }, (tx) =>
        tx.portalEmailLog.create({
          data: {
            tenantId: cfg.tenantId,
            portal: 'unknown',
            sender: sender.slice(0, 200),
            subject: subject.slice(0, 200),
            status: 'IGNORED',
            error: 'Could not extract phone or email from message',
          },
        }),
      );
      return { ok: true, status: 'ignored' };
    }

    const actor: Actor = {
      tenantId: cfg.tenantId,
      userId: null,
      membershipId: null,
      permissions: new Set(['lead:write:all', 'lead:assign']),
      requestId: undefined,
      ip: undefined,
    };

    const lead = await this.leads.create(actor, {
      name: parsed.name,
      phone: parsed.phone ?? null,
      email: parsed.email ?? null,
      location: parsed.location ?? null,
      propertyType: parsed.propertyType ?? null,
      requirements: parsed.requirements ?? null,
      sourceKey: `portal_${parsed.portal}`,
    });

    await this.db.tenantTx({ tenantId: cfg.tenantId }, (tx) =>
      tx.portalEmailLog.create({
        data: {
          tenantId: cfg.tenantId,
          portal: parsed.portal,
          sender: sender.slice(0, 200),
          subject: subject.slice(0, 200),
          status: 'IMPORTED',
          leadId: lead.id,
        },
      }),
    );

    return { ok: true, status: 'imported', leadId: lead.id, portal: parsed.portal };
  }
}
