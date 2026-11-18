import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, type MiddlewareConsumer, Module, type NestModule, Param, Post, Put, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { portalCodeRequestSchema, portalConfigSchema, portalVerifySchema, type PortalConfigInput } from '@leadpilot/validation';
import type { z } from 'zod';
import { RequireFeature } from '../common/billing-meta.js';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators.js';
import type { AppRequest, TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { BotGuard, TurnstileService } from '../security/turnstile.js';
import { PORTAL_COOKIE, PORTAL_SESSION_MINUTES } from './portal-auth.js';
import { PortalService, type PortalCtx } from './portal.service.js';

type PortalRequest = AppRequest & { portal?: PortalCtx };
// Same limit as the other sign-in style endpoints (raised in tests through THROTTLE_AUTH_LIMIT).
const SIGN_IN_THROTTLE = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

/** Authenticates a customer-portal request from the `lp_portal` cookie. Public routes of the app, but never anonymous: no valid portal session, no access. */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(@Inject(PortalService) private readonly portal: PortalService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PortalRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[PORTAL_COOKIE];
    const c = token ? await this.portal.authenticate(token) : null;
    if (!c) throw new UnauthorizedException({ code: 'unauthenticated', message: 'Please sign in again' });
    req.portal = c;
    return true;
  }
}

/** The pages a customer uses. Responses are never cached or indexed. */
@Controller('portal')
class PortalController {
  constructor(@Inject(PortalService) private readonly svc: PortalService, @Inject(TurnstileService) private readonly turnstile: TurnstileService, @Inject(ENV) private readonly env: Env) {}

  // Fixed paths first: they must not be mistaken for a portal key.
  @Public() @UseGuards(PortalGuard) @Get('me') me(@Req() req: PortalRequest) { return this.svc.me(req.portal as PortalCtx); }
  @Public() @UseGuards(PortalGuard) @Get('appointments') appointments(@Req() req: PortalRequest) { return this.svc.appointments(req.portal as PortalCtx); }
  @Public() @UseGuards(PortalGuard) @Post('logout') @HttpCode(204)
  async logout(@Req() req: PortalRequest, @Res({ passthrough: true }) res: Response): Promise<void> { await this.svc.logout(req.portal as PortalCtx); res.clearCookie(PORTAL_COOKIE, { path: '/' }); }

  /** What the sign-in page needs: which business (name and logo only) and the bot-check settings. */
  @Public() @Get(':key')
  async page(@Param('key') key: string) { const p = await this.svc.open(key); return { ...this.svc.signInPage(p), ...(this.turnstile.clientConfig ? { botCheck: this.turnstile.clientConfig } : {}) }; }

  @Public() @UseGuards(BotGuard) @Throttle(SIGN_IN_THROTTLE) @Post(':key/code') @HttpCode(202)
  async code(@Param('key') key: string, @Body(new ZodPipe(portalCodeRequestSchema)) b: z.infer<typeof portalCodeRequestSchema>): Promise<{ status: string }> {
    await this.svc.requestCode(key, b.identity);
    return { status: 'If these details match a record, a code is on its way.' }; // identical whether or not anything matched
  }

  @Public() @Throttle(SIGN_IN_THROTTLE) @Post(':key/verify') @HttpCode(200)
  async verify(@Param('key') key: string, @Body(new ZodPipe(portalVerifySchema)) b: z.infer<typeof portalVerifySchema>, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const r = await this.svc.verifyCode(key, b.identity, b.code);
    res.cookie(PORTAL_COOKIE, r.token, { httpOnly: true, secure: this.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: PORTAL_SESSION_MINUTES * 60_000 });
    return { ok: true };
  }
}

/** Owner-side settings for the portal (Settings, Customer portal). */
@Controller('portal-config')
class PortalAdminController {
  constructor(@Inject(PortalService) private readonly svc: PortalService) {}
  @Get() @RequirePermissions('settings:manage') get(@CurrentTenant() c: TenantRequestContext) { return this.svc.getConfig(c); }
  @Put() @RequireFeature('lead_portal') @RequirePermissions('settings:manage')
  save(@CurrentTenant() c: TenantRequestContext, @Body(new ZodPipe(portalConfigSchema)) b: PortalConfigInput) { return this.svc.saveConfig(c, b); }
  @Post('rotate-key') @HttpCode(200) @RequireFeature('lead_portal') @RequirePermissions('settings:manage') rotate(@CurrentTenant() c: TenantRequestContext) { return this.svc.rotateKey(c); }
}

/** Everything under /portal is personal: never cached by a browser or proxy, never indexed by a search engine. */
function portalHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
}

@Module({ imports: [ConversationsModule], controllers: [PortalController, PortalAdminController], providers: [PortalService, PortalGuard], exports: [PortalService] })
export class PortalModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void { consumer.apply(portalHeaders).forRoutes('portal'); }
}
