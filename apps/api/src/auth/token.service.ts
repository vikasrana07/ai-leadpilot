import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
const ISSUER = 'leadpilot';
const AUDIENCE = 'tenant-app';
/** Platform support access tokens use their own audience: a normal login token is never a support token and vice versa. */
const SUPPORT_AUDIENCE = 'tenant-support';

export interface AccessClaims { userId: string; sessionId: string; tenantId: string | null }

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  constructor(@Inject(ENV) env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async signAccess(c: AccessClaims): Promise<string> {
    return new SignJWT({ sid: c.sessionId, tid: c.tenantId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      const sid = payload.sid;
      const tid = payload.tid;
      if (typeof payload.sub !== 'string' || typeof sid !== 'string') return null;
      return { userId: payload.sub, sessionId: sid, tenantId: typeof tid === 'string' ? tid : null };
    } catch {
      return null;
    }
  }

  async signSupport(c: { adminId: string; sessionId: string; tenantId: string; minutes: number }): Promise<string> {
    return new SignJWT({ sid: c.sessionId, tid: c.tenantId, imp: true })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(c.adminId).setIssuer(ISSUER).setAudience(SUPPORT_AUDIENCE).setIssuedAt().setExpirationTime(`${c.minutes}m`).sign(this.key);
  }

  async verifySupport(token: string): Promise<{ adminId: string; sessionId: string; tenantId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: SUPPORT_AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.tid !== 'string') return null;
      return { adminId: payload.sub, sessionId: payload.sid, tenantId: payload.tid };
    } catch { return null; }
  }
}
