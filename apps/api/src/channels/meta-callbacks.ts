import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';

export interface MetaSignedRequest { userId: string; issuedAt: number | null }

/**
 * Verifies and reads a Facebook `signed_request` ("<signature>.<payload>", both base64url). The signature is HMAC-SHA256 of the payload with the
 * platform app secret. Returns null for anything that is not a correctly signed request for a user (never throws). Per Meta's documentation at
 * planning time (UNVERIFIED against a real callback).
 */
export function parseSignedRequest(signedRequest: unknown, appSecret: string | undefined): MetaSignedRequest | null {
  if (typeof signedRequest !== 'string' || !appSecret || signedRequest.length > 4000) return null;
  const parts = signedRequest.split('.');
  if (parts.length !== 2) return null;
  const [sig, payload] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(sig) || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const want = createHmac('sha256', appSecret).update(payload).digest(); const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { algorithm?: unknown; user_id?: unknown; issued_at?: unknown };
    if (typeof d.algorithm !== 'string' || d.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    if (typeof d.user_id !== 'string' || !/^\d{1,40}$/.test(d.user_id)) return null;
    return { userId: d.user_id, issuedAt: typeof d.issued_at === 'number' ? d.issued_at : null };
  } catch { return null; }
}

const STATUS_TEXT: Record<string, string> = {
  received: 'We received your request. LeadPilot does not store your Facebook profile or any data keyed to your Facebook account: it only stores the WhatsApp Business details a business chose to connect. Those are removed when the business disconnects the number or deletes its workspace. If you are a business owner, do that under Integrations or Settings → Data.',
  completed: 'Your request has been handled. LeadPilot holds no Facebook profile data about you.',
};

/**
 * The callbacks Meta requires of an app that uses Facebook Login or Embedded Signup (ADR 0012): "deauthorize" (a person removed the app) and
 * "data deletion" (a person asked for their data to be deleted, answered with a confirmation code and a status page). All three routes are
 * public and off while Embedded Signup is off. LeadPilot keeps no Facebook-user-keyed data, so a request is recorded (with a hash of the user id)
 * for the operator to follow up; a revoked connection itself is caught by the daily health check and by Meta's account notices.
 */
@Controller('webhooks/meta')
export class MetaCallbacksController {
  private readonly log = new Logger('MetaCallbacks');
  constructor(@Inject(DbService) private readonly db: DbService, @Inject(ENV) private readonly env: Env) {}

  private enabled(): void { if (this.env.EMBEDDED_SIGNUP_MODE === 'off') throw new NotFoundException({ code: 'not_found', message: 'Not found' }); }
  private read(body: unknown): MetaSignedRequest {
    const parsed = parseSignedRequest((body as { signed_request?: unknown } | null)?.signed_request, this.env.META_APP_SECRET);
    if (!parsed) throw new BadRequestException({ code: 'invalid_signed_request', message: 'Invalid request' });
    return parsed;
  }

  /** Records the request once per person per day (Meta retries), returns its confirmation code. */
  private async record(kind: 'deauthorize' | 'data_deletion', userId: string): Promise<string> {
    const hash = createHash('sha256').update(userId).digest('hex');
    return this.db.userTx(null, async (tx) => {
      const prior = await tx.$queryRaw<{ confirmation_code: string }[]>`SELECT confirmation_code FROM meta_data_requests WHERE fb_user_hash = ${hash} AND kind = ${kind} AND received_at > now() - interval '1 day' ORDER BY received_at DESC LIMIT 1`;
      if (prior[0]) return prior[0].confirmation_code;
      const code = randomBytes(18).toString('base64url');
      await tx.$executeRaw`INSERT INTO meta_data_requests (kind, confirmation_code, fb_user_hash) VALUES (${kind}, ${code}, ${hash})`;
      return code;
    });
  }

  @Public() @SkipThrottle() @Post('deauthorize') @HttpCode(200)
  async deauthorize(@Body() body: unknown): Promise<{ status: string }> {
    this.enabled();
    const sr = this.read(body);
    await this.record('deauthorize', sr.userId);
    this.log.warn('A Facebook user removed the LeadPilot app. Connected WhatsApp numbers are re-checked daily and flagged if their token stopped working.');
    return { status: 'ok' };
  }

  @Public() @SkipThrottle() @Post('data-deletion') @HttpCode(200)
  async dataDeletion(@Body() body: unknown): Promise<{ url: string; confirmation_code: string }> {
    this.enabled();
    const sr = this.read(body);
    const code = await this.record('data_deletion', sr.userId);
    return { url: `${this.env.WEB_ORIGIN}/data-deletion?code=${code}`, confirmation_code: code };
  }

  /** Public status page data for a confirmation code. Unguessable code; reveals nothing but the status. */
  @Public() @Get('data-deletion/:code')
  async status(@Param('code') code: string): Promise<{ status: string; receivedAt: string; message: string }> {
    this.enabled();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) throw new NotFoundException({ code: 'not_found', message: 'Not found' });
    const r = (await this.db.userTx(null, (tx) => tx.$queryRaw<{ status: string; received_at: Date }[]>`SELECT status, received_at FROM meta_data_requests WHERE confirmation_code = ${code} AND kind = 'data_deletion'`))[0];
    if (!r) throw new NotFoundException({ code: 'not_found', message: 'Not found' });
    return { status: r.status, receivedAt: r.received_at.toISOString(), message: STATUS_TEXT[r.status] ?? STATUS_TEXT.received as string };
  }
}
