import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import type { AppRequest } from '../common/request-context.js';

export const TURNSTILE_HEADER = 'x-turnstile-token';
export const MOCK_PASS_TOKEN = 'mock-pass';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Bot check for unauthenticated endpoints (Cloudflare Turnstile). Fails CLOSED: a missing token, a rejected token, a timeout or any
 * network error all deny the request. `mock` mode (dev/test) accepts only the literal token "mock-pass". `off` skips the check
 * (production refuses `off` unless TURNSTILE_ALLOW_OFF_IN_PRODUCTION is set). Rate limits are enforced separately and still apply.
 */
@Injectable()
export class TurnstileService {
  private readonly log = new Logger('Turnstile');
  constructor(@Inject(ENV) private readonly env: Env) {}

  get mode(): Env['TURNSTILE_MODE'] { return this.env.TURNSTILE_MODE; }
  /** What a browser client needs to run the challenge. */
  get clientConfig(): { mode: 'mock' | 'live'; siteKey: string | null } | null {
    return this.env.TURNSTILE_MODE === 'off' ? null : { mode: this.env.TURNSTILE_MODE, siteKey: this.env.TURNSTILE_SITE_KEY ?? null };
  }

  async verify(token: string | undefined, ip: string | undefined): Promise<boolean> {
    if (this.env.TURNSTILE_MODE === 'off') return true;
    if (!token || token.length > 2048) return false;
    if (this.env.TURNSTILE_MODE === 'mock') return token === MOCK_PASS_TOKEN;
    try {
      const body = new URLSearchParams({ secret: this.env.TURNSTILE_SECRET ?? '', response: token, ...(ip ? { remoteip: ip } : {}) });
      const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return false;
      return ((await res.json()) as { success?: boolean }).success === true;
    } catch (e) {
      this.log.warn(`Turnstile verification unavailable, denying: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
}

/** Use on public routes: `@UseGuards(BotGuard)`. Runs after the global rate limiter. */
@Injectable()
export class BotGuard implements CanActivate {
  constructor(@Inject(TurnstileService) private readonly turnstile: TurnstileService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const ok = await this.turnstile.verify(req.header(TURNSTILE_HEADER), req.ip);
    if (!ok) throw new ForbiddenException({ code: 'bot_check_failed', message: 'We could not verify that you are a person. Please try again.' });
    return true;
  }
}
