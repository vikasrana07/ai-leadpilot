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
import { PLATFORM_TTL_SECONDS, PlatformGuard, type PlatformRequest } from './platform-auth.js';
import { PlatformService } from './platform.service.js';

const meta = (r: PlatformRequest) => ({ ip: r.ip, requestId: r.requestId });
const admin = (r: PlatformRequest) => { if (!r.platformAdmin) throw new Error('platform guard missing'); return r.platformAdmin; };
const uuid = () => new ParseUUIDPipe();
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
    res.cookie(PLATFORM_COOKIE, r.token, { httpOnly: true, secure: this.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: PLATFORM_TTL_SECONDS * 1000 });
    return { admin: r.admin };
  }

  @Post('auth/logout') @HttpCode(204) logout(@Res({ passthrough: true }) res: Response): void { res.clearCookie(PLATFORM_COOKIE, { path: '/' }); }

  @UseGuards(PlatformGuard) @Get('me') me(@Req() req: PlatformRequest) { return { admin: admin(req) }; }
  @UseGuards(PlatformGuard) @Get('metrics') metrics() { return this.svc.metrics(); }
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
