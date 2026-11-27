import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators.js';
import type { AppRequest, TenantRequestContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { InboundService } from '../conversations/inbound.service.js';
import { SecretBox } from '../crypto/secret-box.js';
import { DbService } from '../db/db.module.js';

const connectSocialSchema = z.object({
  type: z.enum(['MESSENGER', 'INSTAGRAM']),
  name: z.string().trim().min(2).max(80),
  externalId: z.string().trim().min(3).max(80),
  accessToken: z.string().trim().min(10).max(1000),
  appSecret: z.string().trim().min(8).max(200),
});

@Controller('channels/meta-social')
export class MetaSocialAdminController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SecretBox) private readonly box: SecretBox,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('integration:manage')
  async list(@CurrentTenant() ctx: TenantRequestContext) {
    const rows = await this.db.tenantTx(ctx, (tx) =>
      tx.channel.findMany({
        where: { tenantId: ctx.tenantId, type: { in: ['MESSENGER', 'INSTAGRAM'] } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      status: r.status,
      externalId: r.externalId,
      webhookPath: r.webhookKey ? `/webhooks/meta-social/${r.webhookKey}` : null,
      verifyToken: (r.config as { verifyToken?: string } | null)?.verifyToken ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('integration:manage')
  async connect(
    @CurrentTenant() ctx: TenantRequestContext,
    @Body(new ZodPipe(connectSocialSchema)) body: z.infer<typeof connectSocialSchema>,
  ) {
    const sealed = await this.box.seal(
      {
        accessToken: body.accessToken,
        appSecret: body.appSecret,
      },
      ctx.tenantId,
    );
    const webhookKey = `ms_${crypto.randomBytes(16).toString('base64url')}`;
    const verifyToken = `vt_${crypto.randomBytes(12).toString('base64url')}`;

    const ch = await this.db.tenantTx(ctx, async (tx) => {
      const cred = await tx.integrationCredential.create({
        data: {
          tenantId: ctx.tenantId,
          provider: body.type.toLowerCase(),
          ciphertext: sealed.ciphertext,
          wrappedKey: sealed.wrappedKey,
          keyId: sealed.keyId,
          status: 'active',
        },
      });
      const created = await tx.channel.create({
        data: {
          tenantId: ctx.tenantId,
          type: body.type,
          name: body.name,
          status: 'ACTIVE',
          externalId: body.externalId,
          webhookKey,
          credentialId: cred.id,
          config: { verifyToken },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'channel.meta_social_connected',
        resourceType: 'channel',
        resourceId: created.id,
        metadata: { type: body.type, externalId: body.externalId },
        requestId: ctx.requestId,
        ip: ctx.ip,
      });
      return created;
    });

    return {
      id: ch.id,
      type: ch.type,
      name: ch.name,
      status: ch.status,
      externalId: ch.externalId,
      webhookPath: `/webhooks/meta-social/${webhookKey}`,
      verifyToken,
    };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('integration:manage')
  async disconnect(@CurrentTenant() ctx: TenantRequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.db.tenantTx(ctx, async (tx) => {
      const ch = await tx.channel.findFirst({
        where: { id, tenantId: ctx.tenantId, type: { in: ['MESSENGER', 'INSTAGRAM'] } },
      });
      if (!ch) throw new NotFoundException({ code: 'not_found', message: 'Channel not found' });
      await tx.channel.update({ where: { id: ch.id }, data: { status: 'DISABLED' } });
    });
  }
}

@Controller('webhooks/meta-social')
export class MetaSocialWebhookController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SecretBox) private readonly box: SecretBox,
    @Inject(InboundService) private readonly inbound: InboundService,
  ) {}

  @Public()
  @Get(':webhookKey')
  async verify(
    @Param('webhookKey') webhookKey: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const ch = (
      await this.db.userTx(null, (tx) =>
        tx.$queryRaw<{ id: string; tenant_id: string; type: string; status: string; external_id: string | null; config: unknown; credential_id: string | null }[]>`SELECT * FROM find_channel_by_webhook_key(${webhookKey})`,
      )
    )[0];
    const expected = (ch?.config as { verifyToken?: string } | null)?.verifyToken;
    if (!ch || (ch.type !== 'MESSENGER' && ch.type !== 'INSTAGRAM') || mode !== 'subscribe' || !expected || token !== expected) {
      throw new UnauthorizedException({ code: 'invalid_verify_token', message: 'Invalid verification token' });
    }
    return challenge ?? 'ok';
  }

  @Public()
  @Post(':webhookKey')
  @HttpCode(200)
  async receive(
    @Param('webhookKey') webhookKey: string,
    @Headers('x-hub-signature-256') sigHeader: string | undefined,
    @Req() req: AppRequest & { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
  ) {
    const row = (
      await this.db.userTx(null, (tx) =>
        tx.$queryRaw<{ id: string; tenant_id: string; type: string; status: string; external_id: string | null; config: unknown; credential_id: string | null }[]>`SELECT * FROM find_channel_by_webhook_key(${webhookKey})`,
      )
    )[0];
    if (!row || (row.type !== 'MESSENGER' && row.type !== 'INSTAGRAM') || row.status !== 'ACTIVE' || !row.credential_id) {
      throw new NotFoundException({ code: 'not_found', message: 'Channel not found' });
    }
    const ch = { id: row.id, tenantId: row.tenant_id, type: row.type as 'MESSENGER' | 'INSTAGRAM', status: row.status, externalId: row.external_id, config: row.config, credentialId: row.credential_id };

    const cred = await this.db.tenantTx({ tenantId: ch.tenantId }, (tx) =>
      tx.integrationCredential.findFirst({ where: { id: ch.credentialId!, tenantId: ch.tenantId } }),
    );
    if (!cred) throw new NotFoundException({ code: 'not_found', message: 'Credentials missing' });

    const secrets = await this.box.open(
      {
        ciphertext: cred.ciphertext,
        wrappedKey: cred.wrappedKey,
        keyId: cred.keyId,
      },
      ch.tenantId,
    );

    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}), 'utf8');
    const expectedSig = `sha256=${crypto.createHmac('sha256', secrets.appSecret ?? '').update(raw).digest('hex')}`;
    if (!sigHeader || sigHeader.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expectedSig))) {
      throw new BadRequestException({ code: 'invalid_signature', message: 'Invalid Meta signature' });
    }

    const entries = Array.isArray(body?.entry) ? (body.entry as Record<string, unknown>[]) : [];
    let processed = 0;
    for (const entry of entries) {
      const messaging = Array.isArray(entry.messaging) ? (entry.messaging as Record<string, unknown>[]) : [];
      for (const ev of messaging) {
        const senderId = (ev.sender as { id?: string } | undefined)?.id;
        const msg = ev.message as { mid?: string; text?: string; is_echo?: boolean } | undefined;
        if (!senderId || !msg?.text || msg.is_echo) continue;
        await this.inbound.ingest({
          tenantId: ch.tenantId,
          channel: { id: ch.id, type: ch.type as 'MESSENGER' | 'INSTAGRAM' },
          externalThreadId: senderId,
          contact: { name: `${ch.type === 'INSTAGRAM' ? 'IG' : 'FB'} User ${senderId.slice(-4)}` },
          message: {
            type: 'TEXT',
            body: msg.text,
            externalId: msg.mid ?? `${senderId}:${ev.timestamp ?? Date.now()}`,
            at: new Date(),
          },
          source: ch.type === 'INSTAGRAM' ? 'instagram' : 'messenger',
        });
        processed++;
      }
    }

    return { ok: true, processed };
  }
}
