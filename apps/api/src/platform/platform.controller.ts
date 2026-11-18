import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { planInputSchema, planUpdateSchema, platformAssignPlanSchema, platformLoginSchema, platformReasonSchema, platformTenantsQuerySchema, type PlanInput } from '@leadpilot/validation';
import { z } from 'zod';
import { Public } from '../common/decorators.js';
import { PLATFORM_COOKIE } from '../common/middleware.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { confirmSchema, proofSchema } from '../mfa/mfa.controller.js';
import type { MfaProof } from '../mfa/mfa.service.js';
import { PLATFORM_TTL_SECONDS, PlatformGuard, type PlatformRequest } from './platform-auth.js';
import { PlatformService } from './platform.service.js';

const meta = (r: PlatformRequest) => ({ ip: r.ip, requestId: r.requestId });
const admin = (r: PlatformRequest) => { if (!r.platformAdmin) throw new Error('platform guard missing'); return r.platformAdmin; };
const uuid = () => new ParseUUIDPipe();
const platformMfaLoginSchema = z.object({ challengeToken: z.string().min(20).max(2000), code: z.string().trim().regex(/^\d{6}$/).optional(), recoveryCode: z.string().trim().min(8).max(32).optional() }).refine((v) => !!v.code !== !!v.recoveryCode, 'Send either a code or a recovery code');
const LOGIN_THROTTLE = { default: { limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

/**
 * The platform console: a separate surface from tenant auth. `@Public()` only switches off the TENANT guards; PlatformGuard
 * (different token audience, different secret, separate admin table) protects everything except login.
 */
@Public() @Controller('platform')
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly svc: PlatformService, @Inject(ENV) private readonly env: Env) {}

  @Post('auth/login') @HttpCode(200) @Throttle(LOGIN_THROTTLE)
  async login(@Body(new ZodPipe(platformLoginSchema)) b: z.infer<typeof platformLoginSchema>, @Req() req: PlatformRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.login(b.email, b.password, meta(req));
    if ('mfaRequired' in r) return r; // second step needed: no cookie yet
    this.setCookie(res, r.token);
    return { admin: r.admin };
  }

  private setCookie(res: Response, token: string): void {
    res.cookie(PLATFORM_COOKIE, token, { httpOnly: true, secure: this.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: PLATFORM_TTL_SECONDS * 1000 });
  }

  @Post('auth/mfa') @HttpCode(200) @Throttle(LOGIN_THROTTLE)
  async mfaStep(@Body(new ZodPipe(platformMfaLoginSchema)) b: z.infer<typeof platformMfaLoginSchema>, @Req() req: PlatformRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.loginWithMfa(b.challengeToken, { code: b.code, recoveryCode: b.recoveryCode }, meta(req));
    this.setCookie(res, r.token);
    return { admin: r.admin };
  }

  @UseGuards(PlatformGuard) @Get('security/mfa') async mfaStatus(@Req() r: PlatformRequest) { return this.svc.mfa.status(this.svc.mfaSubject(admin(r))); }
  @UseGuards(PlatformGuard) @Post('security/mfa/enroll') @HttpCode(200) mfaEnroll(@Req() r: PlatformRequest) { return this.svc.mfa.startEnrollment(this.svc.mfaSubject(admin(r)), r.ip); }
  @UseGuards(PlatformGuard) @Post('security/mfa/confirm') @HttpCode(200) @Throttle(LOGIN_THROTTLE) mfaConfirm(@Req() r: PlatformRequest, @Body(new ZodPipe(confirmSchema)) b: { code: string }) { return this.svc.mfa.confirmEnrollment(this.svc.mfaSubject(admin(r)), b.code, r.ip); }
  @UseGuards(PlatformGuard) @Post('security/mfa/recovery-codes') @HttpCode(200) @Throttle(LOGIN_THROTTLE) mfaCodes(@Req() r: PlatformRequest, @Body(new ZodPipe(proofSchema)) b: MfaProof) { return this.svc.mfa.regenerateRecoveryCodes(this.svc.mfaSubject(admin(r)), b, r.ip); }
  @UseGuards(PlatformGuard) @Post('security/mfa/disable') @HttpCode(204) @Throttle(LOGIN_THROTTLE) async mfaDisable(@Req() r: PlatformRequest, @Body(new ZodPipe(proofSchema)) b: MfaProof): Promise<void> { await this.svc.mfa.disable(this.svc.mfaSubject(admin(r)), b, r.ip); }

  @Post('auth/logout') @HttpCode(204) logout(@Res({ passthrough: true }) res: Response): void { res.clearCookie(PLATFORM_COOKIE, { path: '/' }); }

  @UseGuards(PlatformGuard) @Get('me') me(@Req() req: PlatformRequest) { return { admin: admin(req) }; }
  @UseGuards(PlatformGuard) @Get('metrics') metrics() { return this.svc.metrics(); }
  @UseGuards(PlatformGuard) @Get('ops') ops() { return this.svc.ops(); }
  @UseGuards(PlatformGuard) @Get('tenants') tenants(@Query(new ZodPipe(platformTenantsQuerySchema)) q: z.infer<typeof platformTenantsQuerySchema>) { return this.svc.tenants(q); }
  @UseGuards(PlatformGuard) @Get('tenants/:id') tenant(@Param('id', uuid()) id: string) { return this.svc.tenant(id); }
  @UseGuards(PlatformGuard) @Post('tenants/:id/suspend') @HttpCode(200) suspend(@Req() r: PlatformRequest, @Param('id', uuid()) id: string, @Body(new ZodPipe(platformReasonSchema)) b: { reason: string }) { return this.svc.setTenantStatus(admin(r), meta(r), id, 'SUSPENDED', b.reason); }
  @UseGuards(PlatformGuard) @Post('tenants/:id/reactivate') @HttpCode(200) reactivate(@Req() r: PlatformRequest, @Param('id', uuid()) id: string, @Body(new ZodPipe(platformReasonSchema)) b: { reason: string }) { return this.svc.setTenantStatus(admin(r), meta(r), id, 'ACTIVE', b.reason); }
  @UseGuards(PlatformGuard) @Post('tenants/:id/plan') @HttpCode(200) assign(@Req() r: PlatformRequest, @Param('id', uuid()) id: string, @Body(new ZodPipe(platformAssignPlanSchema)) b: z.infer<typeof platformAssignPlanSchema>) { return this.svc.assignPlan(admin(r), meta(r), id, b); }

  @UseGuards(PlatformGuard) @Get('plans') plans() { return this.svc.plans(); }
  @UseGuards(PlatformGuard) @Post('plans') @HttpCode(201) createPlan(@Req() r: PlatformRequest, @Body(new ZodPipe(planInputSchema)) b: PlanInput) { return this.svc.createPlan(admin(r), meta(r), b); }
  @UseGuards(PlatformGuard) @Patch('plans/:key') updatePlan(@Req() r: PlatformRequest, @Param('key') key: string, @Body(new ZodPipe(planUpdateSchema)) b: z.infer<typeof planUpdateSchema>) {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(key)) throw new NotFoundException({ code: 'not_found', message: 'Plan not found' });
    return this.svc.updatePlan(admin(r), meta(r), key, b);
  }
  @UseGuards(PlatformGuard) @Get('audit') audit() { return this.svc.auditLog(); }
}
