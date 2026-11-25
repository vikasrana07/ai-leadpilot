import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentTenant, Public, RequirePermissions } from '../common/decorators.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../common/middleware.js';
import type { AppRequest, TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Env } from '../config/env.js';
import type { ClientMeta, IssuedSession } from './auth.service.js';
import { SsoService } from './sso.service.js';
import { ACCESS_TTL_SECONDS } from './token.service.js';

const AUTH_THROTTLE = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

const ssoConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['OIDC', 'SAML']),
  autoProvision: z.boolean().optional(),
  defaultRole: z.string().trim().min(1).max(40).optional(),
  issuerUrl: z.string().url().optional(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  userinfoEndpoint: z.string().url().optional(),
  clientId: z.string().trim().min(1).max(200).optional(),
  clientSecret: z.string().min(1).max(500).optional(),
  entityId: z.string().trim().min(1).max(500).optional(),
  ssoUrl: z.string().url().optional(),
  certificatePem: z.string().min(10).max(8000).optional(),
});

const oidcCallbackSchema = z.object({
  code: z.string().min(1).max(2000),
  state: z.string().min(10).max(2000),
  mockClaims: z.object({ email: z.string().email(), name: z.string().optional() }).optional(),
});

const samlCallbackSchema = z.object({
  SAMLResponse: z.string().min(10).max(100_000),
  RelayState: z.string().min(10).max(2000),
});

@Controller('auth/sso')
export class SsoController {
  constructor(
    @Inject(SsoService) private readonly sso: SsoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private meta(req: AppRequest): ClientMeta {
    return { ip: req.ip, userAgent: req.header('user-agent'), requestId: req.requestId };
  }

  private respond(req: AppRequest, res: Response, s: IssuedSession) {
    const secure = this.env.NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE, s.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_TTL_SECONDS * 1000 });
    if (s.refreshToken && s.refreshExpiresAt) {
      res.cookie(REFRESH_COOKIE, s.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/auth', expires: s.refreshExpiresAt });
    }
    const wantsBody = req.header('x-token-delivery') === 'body';
    return wantsBody ? { ...s.context, accessToken: s.accessToken, refreshToken: s.refreshToken } : s.context;
  }

  @Get('config')
  @RequirePermissions('settings:manage')
  getConfig(@CurrentTenant() ctx: TenantRequestContext) {
    return this.sso.getConfig(ctx.tenantId);
  }

  @Put('config')
  @RequirePermissions('settings:manage')
  saveConfig(@CurrentTenant() ctx: TenantRequestContext, @Body(new ZodPipe(ssoConfigSchema)) body: z.infer<typeof ssoConfigSchema>) {
    return this.sso.saveConfig(ctx, body);
  }

  @Delete('config')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  deleteConfig(@CurrentTenant() ctx: TenantRequestContext) {
    return this.sso.deleteConfig(ctx);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get('initiate')
  initiate(@Query('tenantSlug') tenantSlug?: string, @Query('tenantId') tenantId?: string) {
    return this.sso.initiateLogin({
      ...(tenantSlug ? { tenantSlug } : {}),
      ...(tenantId ? { tenantId } : {}),
    });
  }

  @Public()
  @Get('metadata/:tenantId')
  @Header('Content-Type', 'application/samlmetadata+xml; charset=utf-8')
  metadata(@Param('tenantId', new ParseUUIDPipe()) tenantId: string) {
    return this.sso.getSamlMetadata(tenantId);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('callback/oidc')
  @HttpCode(200)
  async oidcCallback(
    @Body(new ZodPipe(oidcCallbackSchema)) body: z.infer<typeof oidcCallbackSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.sso.handleOidcCallback(body, this.meta(req));
    return this.respond(req, res, session);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('callback/saml')
  @HttpCode(200)
  async samlCallback(
    @Body(new ZodPipe(samlCallbackSchema)) body: z.infer<typeof samlCallbackSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.sso.handleSamlCallback(body, this.meta(req));
    return this.respond(req, res, session);
  }
}
