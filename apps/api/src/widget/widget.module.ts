import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Headers, HttpCode, Inject, Injectable, Module, NotFoundException, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { widgetMessageSchema, widgetSessionSchema } from '@leadpilot/validation';
import type { z } from 'zod';
import { Public } from '../common/decorators.js';
import { normalizeEmail, normalizePhone } from '../common/phone.js';
import type { AppRequest } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { InboundService } from '../conversations/inbound.service.js';
import { DbService } from '../db/db.module.js';
import { BotGuard, TurnstileService } from '../security/turnstile.js';
import { WIDGET_JS } from './widget-script.js';

interface WidgetRow { tenant_id: string; channel_id: string; enabled: boolean; allowed_origins: string[]; theme: { color?: string; position?: string }; title: string; greeting: string }
interface SessionClaims { cid: string; tid: string; ch: string; th: string; pk: string; since: number }
const SESSION_TTL = '7d';

@Injectable()
export class WidgetPublicService {
  private readonly key: Uint8Array;
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(InboundService) private readonly inbound: InboundService, @Inject(TurnstileService) private readonly turnstile: TurnstileService, @Inject(ENV) env: Env) { this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET); }

  private async widgetByKey(pk: string): Promise<WidgetRow | null> {
    if (!/^pk_[A-Za-z0-9_-]{10,60}$/.test(pk)) return null;
    const rows = await this.db.userTx(null, (tx) => tx.$queryRaw<WidgetRow[]>`SELECT * FROM find_widget_by_public_key(${pk})`);
    return rows[0] ?? null;
  }

  /** Browsers always send Origin on cross-origin fetches. Only the website addresses the owner allow-listed may use the widget. */
  private assertOrigin(origin: string | undefined, w: WidgetRow): void {
    if (!origin || !w.allowed_origins.includes(origin)) throw new ForbiddenException({ code: 'origin_not_allowed', message: 'This website is not allowed to use this chat widget' });
  }

  async config(pk: string, origin: string | undefined) {
    const w = await this.widgetByKey(pk);
    if (!w) throw new NotFoundException({ code: 'not_found', message: 'Unknown widget' });
    this.assertOrigin(origin, w);
    return { enabled: w.enabled, title: w.title, greeting: w.greeting, color: w.theme.color ?? '#3f55e8', position: w.theme.position ?? 'right', ...(this.turnstile.clientConfig ? { botCheck: this.turnstile.clientConfig } : {}) };
  }

  async createSession(input: z.infer<typeof widgetSessionSchema>, origin: string | undefined) {
    const w = await this.widgetByKey(input.key);
    if (!w || !w.enabled) throw new NotFoundException({ code: 'not_found', message: 'Unknown widget' });
    this.assertOrigin(origin, w);
    const phone = normalizePhone(input.phone);
    if (input.phone && !phone) throw new BadRequestException({ code: 'validation_error', message: 'Enter a valid phone number', details: [{ path: 'phone', message: 'Enter a valid phone number' }] });
    const identity = phone?.norm ?? normalizeEmail(input.email) ?? '';
    // One conversation per contact per widget, so a returning visitor continues the same thread.
    const th = createHash('sha256').update(`${w.tenant_id}|${identity}`).digest('hex').slice(0, 32);
    const now = new Date();
    const r = await this.db.tenantTx({ tenantId: w.tenant_id }, (tx) => this.inbound.resolveThread(tx, w.tenant_id, { id: w.channel_id, type: 'WEB_WIDGET' }, th, { name: input.name, phone: phone?.display ?? null, email: input.email ?? null }, 'website_widget', now));
    const token = await new SignJWT({ cid: r.conversationId, tid: w.tenant_id, ch: w.channel_id, th, pk: input.key, since: now.getTime() } satisfies SessionClaims)
      .setProtectedHeader({ alg: 'HS256' }).setAudience('widget').setIssuer('leadpilot').setIssuedAt().setExpirationTime(SESSION_TTL).sign(this.key);
    return { token };
  }

  /** Verifies the session token AND that its widget still exists, is enabled and allows this origin (key rotation revokes sessions). */
  private async session(auth: string | undefined, origin: string | undefined): Promise<SessionClaims> {
    const token = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    let claims: SessionClaims;
    try { claims = (await jwtVerify(token, this.key, { audience: 'widget', issuer: 'leadpilot', algorithms: ['HS256'] })).payload as unknown as SessionClaims; }
    catch { throw new UnauthorizedException({ code: 'invalid_session', message: 'Session expired' }); }
    const w = await this.widgetByKey(claims.pk);
    if (!w || !w.enabled || w.tenant_id !== claims.tid || w.channel_id !== claims.ch) throw new UnauthorizedException({ code: 'invalid_session', message: 'Session expired' });
    this.assertOrigin(origin, w);
    return claims;
  }

  async postMessage(auth: string | undefined, origin: string | undefined, text: string) {
    const c = await this.session(auth, origin);
    const r = await this.inbound.ingest({ tenantId: c.tid, channel: { id: c.ch, type: 'WEB_WIDGET' }, externalThreadId: c.th, contact: { name: '' }, message: { type: 'TEXT', body: text, externalId: `w_${randomUUID()}`, at: new Date() }, source: 'website_widget' });
    return { ok: true, duplicate: r.duplicate };
  }

  async messages(auth: string | undefined, origin: string | undefined) {
    const c = await this.session(auth, origin);
    const rows = await this.db.tenantTx({ tenantId: c.tid }, (tx) => tx.message.findMany({ where: { conversationId: c.cid, createdAt: { gte: new Date(c.since) }, type: 'TEXT' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200, select: { id: true, direction: true, body: true, createdAt: true } }));
    return { items: rows.map((m) => ({ id: m.id, from: m.direction === 'INBOUND' ? 'visitor' : 'team', text: m.body ?? '', at: m.createdAt.toISOString() })) };
  }
}

@Controller()
class WidgetPublicController {
  constructor(@Inject(WidgetPublicService) private readonly svc: WidgetPublicService) {}

  @Public() @Get('widget.js') @Header('Content-Type', 'application/javascript; charset=utf-8') @Header('Cache-Control', 'public, max-age=300') @Header('Cross-Origin-Resource-Policy', 'cross-origin') @Header('X-Content-Type-Options', 'nosniff')
  script(): string { return WIDGET_JS; }

  @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @Get('widget/config')
  config(@Query('key') key: string | undefined, @Headers('origin') origin: string | undefined) { return this.svc.config(key ?? '', origin); }

  @Public() @UseGuards(BotGuard) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('widget/sessions') @HttpCode(201)
  session(@Body(new ZodPipe(widgetSessionSchema)) b: z.infer<typeof widgetSessionSchema>, @Headers('origin') origin: string | undefined) { return this.svc.createSession(b, origin); }

  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Post('widget/messages') @HttpCode(201)
  post(@Body(new ZodPipe(widgetMessageSchema)) b: { text: string }, @Headers('authorization') auth: string | undefined, @Headers('origin') origin: string | undefined) { return this.svc.postMessage(auth, origin, b.text); }

  @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @Get('widget/messages')
  list(@Headers('authorization') auth: string | undefined, @Headers('origin') origin: string | undefined, @Req() _req: AppRequest) { return this.svc.messages(auth, origin); }
}

@Module({ imports: [ConversationsModule], controllers: [WidgetPublicController], providers: [WidgetPublicService] })
export class WidgetModule {}
