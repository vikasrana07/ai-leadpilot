import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  acceptInviteSchema, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, switchWorkspaceSchema, verifyEmailSchema,
  type AcceptInviteInput, type LoginInput, type RegisterInput,
} from '@leadpilot/validation';
import { CurrentAuth, NoTenant, Public } from '../common/decorators.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../common/middleware.js';
import type { AppRequest, AuthContext } from '../common/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Inject as InjectToken } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { BotGuard } from '../security/turnstile.js';
import { AuthService, type ClientMeta, type IssuedSession } from './auth.service.js';
import { supportMe } from '../support/support-access.js';
import { ACCESS_TTL_SECONDS } from './token.service.js';

// Resolved per request so deployments/tests can tune it via THROTTLE_AUTH_LIMIT (validated in config/env.ts).
const mfaLoginSchema = z.object({ challengeToken: z.string().min(20).max(2000), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(), recoveryCode: z.string().trim().min(8).max(32).optional() }).refine((v) => !!v.code !== !!v.recoveryCode, 'Send either a code or a recovery code');
const AUTH_THROTTLE = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @InjectToken(ENV) private readonly env: Env,
  ) {}

  private meta(req: AppRequest): ClientMeta {
    return { ip: req.ip, userAgent: req.header('user-agent'), requestId: req.requestId };
  }

  private setCookies(res: Response, s: { accessToken: string; refreshToken?: string; refreshExpiresAt?: Date }): void {
    const secure = this.env.NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE, s.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_TTL_SECONDS * 1000 });
    if (s.refreshToken && s.refreshExpiresAt) {
      res.cookie(REFRESH_COOKIE, s.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/auth', expires: s.refreshExpiresAt });
    }
  }

  private respond(req: AppRequest, res: Response, s: IssuedSession) {
    this.setCookies(res, s);
    // Non-browser clients (mobile, tests) opt in to receive tokens in the body. Browsers use httpOnly cookies only.
    const wantsBody = req.header('x-token-delivery') === 'body';
    return wantsBody ? { ...s.context, accessToken: s.accessToken, refreshToken: s.refreshToken } : s.context;
  }

  @Public() @UseGuards(BotGuard) @Throttle(AUTH_THROTTLE) @Post('register') @HttpCode(201)
  async register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.register(body, this.meta(req));
    // Same status/shape for existing emails (the user gets an email instead): no account enumeration.
    if (!session) return { message: 'Check your email to continue.' };
    return this.respond(req, res, session);
  }

  @Public() @UseGuards(BotGuard) @Throttle(AUTH_THROTTLE) @Post('login') @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body, this.meta(req));
    if ('mfaRequired' in r) return r; // no cookies, no session: the client must complete the second step
    return this.respond(req, res, r);
  }

  /** Second step of sign-in for accounts with MFA. Throttled; per-account lockout lives in MfaService. */
  @Public() @Throttle(AUTH_THROTTLE) @Post('mfa/verify') @HttpCode(200)
  async mfaVerify(@Body(new ZodPipe(mfaLoginSchema)) body: z.infer<typeof mfaLoginSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.loginWithMfa(body.challengeToken, { code: body.code, recoveryCode: body.recoveryCode }, this.meta(req)));
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('refresh') @HttpCode(200)
  async refresh(@Body() body: { refreshToken?: string } | undefined, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.[REFRESH_COOKIE] ?? (typeof body?.refreshToken === 'string' ? body.refreshToken : undefined);
    if (!token) throw new UnauthorizedException({ code: 'invalid_refresh', message: 'Session expired' });
    return this.respond(req, res, await this.auth.refresh(token, this.meta(req)));
  }

  @NoTenant() @Post('logout') @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext | undefined, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (auth) await this.auth.logout(auth.sessionId, auth.userId, auth.activeTenantId, this.meta(req));
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }

  @NoTenant() @Get('me')
  async me(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    if (req.support) return supportMe(req, await this.auth.workspaceName(auth.activeTenantId as string)); // platform support session
    return this.auth.buildContext(auth.userId, auth.activeTenantId);
  }

  @NoTenant() @Post('switch-workspace') @HttpCode(200)
  async switchWorkspace(@Body(new ZodPipe(switchWorkspaceSchema)) body: { tenantId: string }, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.switchWorkspace(auth.userId, auth.sessionId, body.tenantId, this.meta(req));
    this.setCookies(res, { accessToken: r.accessToken });
    return req.header('x-token-delivery') === 'body' ? { ...r.context, accessToken: r.accessToken } : r.context;
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('verify-email') @HttpCode(204)
  verify(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }, @Req() req: AppRequest): Promise<void> {
    return this.auth.verifyEmail(body.token, this.meta(req));
  }

  @NoTenant() @Throttle(AUTH_THROTTLE) @Post('resend-verification') @HttpCode(204)
  resend(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.auth.resendVerification(auth.userId);
  }

  @Public() @UseGuards(BotGuard) @Throttle(AUTH_THROTTLE) @Post('forgot-password') @HttpCode(202)
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }) {
    await this.auth.forgotPassword(body.email);
    return { message: 'If an account exists for that email, a reset link is on its way.' };
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('reset-password') @HttpCode(204)
  reset(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string }, @Req() req: AppRequest): Promise<void> {
    return this.auth.resetPassword(body.token, body.password, this.meta(req));
  }

  @NoTenant() @Get('sessions')
  sessions(@CurrentAuth() auth: AuthContext) {
    return this.auth.listSessions(auth.userId, auth.sessionId);
  }

  @NoTenant() @Delete('sessions/:id') @HttpCode(204)
  revoke(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest): Promise<void> {
    return this.auth.revokeSession(auth.userId, id, auth.activeTenantId, this.meta(req));
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('invitations/preview') @HttpCode(200)
  preview(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }) {
    return this.auth.previewInvitation(body.token);
  }

  @Public() @Throttle(AUTH_THROTTLE) @Post('invitations/accept') @HttpCode(200)
  async accept(@Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput, @CurrentAuth() auth: AuthContext | undefined, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.acceptInvitation(body, auth?.userId, this.meta(req)));
  }
}
