import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { SecretBox } from '../crypto/secret-box.js';
import { DbService } from '../db/db.module.js';
import { otpauthUri, generateSecret, verifyTotp } from './totp.js';

export type SubjectType = 'user' | 'platform_admin';
export interface MfaSubject { type: SubjectType; id: string; label: string }
export interface MfaProof { code?: string | undefined; recoveryCode?: string | undefined }

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60_000;
const RECOVERY_CODES = 10;
const CHALLENGE_TTL = '5m';
const ISSUER = 'LeadPilot';
const INVALID = { code: 'invalid_mfa_code', message: 'That code is not valid. Check your authenticator app and try again.' };

const hashRecovery = (code: string) => createHash('sha256').update(code.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
function newRecoveryCode(): string {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
  const pick = () => Array.from(randomBytes(5), (b) => a[b % a.length]).join('');
  return `${pick()}-${pick()}`;
}

/**
 * Time-based one-time passwords for tenant users and platform admins (RFC 6238, no dependency). The TOTP secret is stored
 * envelope-encrypted (SecretBox, key id recorded). Codes are single-use (replay-proof), attempts are limited with a lockout,
 * and recovery codes are random, hashed and single-use.
 */
@Injectable()
export class MfaService {
  private readonly userKey: Uint8Array; private readonly platformKey: Uint8Array | null;
  constructor(
    @Inject(DbService) private readonly db: DbService, @Inject(SecretBox) private readonly box: SecretBox,
    @Inject(AuditService) private readonly audit: AuditService, @Inject(ENV) env: Env,
  ) {
    this.userKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    this.platformKey = env.PLATFORM_JWT_SECRET ? new TextEncoder().encode(env.PLATFORM_JWT_SECRET) : null;
  }

  private aad(s: { type: SubjectType; id: string }) { return `mfa:${s.type}:${s.id}`; }
  private where(s: { type: SubjectType; id: string }) { return { subjectType_subjectId: { subjectType: s.type, subjectId: s.id } }; }

  private async log(s: MfaSubject, action: string, ip: string | undefined, metadata: Record<string, string | number | boolean> = {}) {
    if (s.type === 'user') await this.audit.recordStandalone({ tenantId: null, actorUserId: s.id, action, metadata, ...(ip ? { ip } : {}) });
    else await this.db.prisma.platformAuditLog.createMany({ data: [{ adminId: s.id, action, targetType: 'platform_admin', targetId: s.id, metadata, ip: ip ?? null }] });
  }

  async isEnabled(s: { type: SubjectType; id: string }): Promise<boolean> {
    const c = await this.db.prisma.mfaCredential.findUnique({ where: this.where(s), select: { confirmedAt: true } });
    return !!c?.confirmedAt;
  }

  async status(s: MfaSubject) {
    const c = await this.db.prisma.mfaCredential.findUnique({ where: this.where(s), select: { confirmedAt: true } });
    const remaining = c?.confirmedAt ? await this.db.prisma.mfaRecoveryCode.count({ where: { subjectType: s.type, subjectId: s.id, usedAt: null } }) : 0;
    return { enabled: !!c?.confirmedAt, enrollmentPending: !!c && !c.confirmedAt, recoveryCodesRemaining: remaining };
  }

  // ------------------------------------------------------------------ enrolment
  async startEnrollment(s: MfaSubject, ip: string | undefined) {
    if (await this.isEnabled(s)) throw new ConflictException({ code: 'mfa_already_enabled', message: 'Two-step verification is already on. Turn it off first to set it up again.' });
    const secret = generateSecret();
    const sealed = await this.box.seal({ secret }, this.aad(s));
    const data = { ciphertext: sealed.ciphertext, wrappedKey: sealed.wrappedKey, keyId: sealed.keyId, confirmedAt: null, lastUsedStep: 0n, failedAttempts: 0, lockedUntil: null };
    await this.db.prisma.mfaCredential.upsert({ where: this.where(s), create: { subjectType: s.type, subjectId: s.id, ...data }, update: data });
    await this.log(s, 'auth.mfa_enrollment_started', ip);
    // Shown ONCE here; it is never returned again (only the encrypted copy is stored).
    return { secret, otpauthUri: otpauthUri(ISSUER, s.label, secret), issuer: ISSUER, account: s.label };
  }

  async confirmEnrollment(s: MfaSubject, code: string, ip: string | undefined) {
    const cred = await this.db.prisma.mfaCredential.findUnique({ where: this.where(s) });
    if (!cred || cred.confirmedAt) throw new BadRequestException({ code: 'no_enrollment', message: 'Start set-up first.' });
    await this.assertNotLocked(cred.lockedUntil);
    const secret = (await this.box.open({ ciphertext: cred.ciphertext, wrappedKey: cred.wrappedKey, keyId: cred.keyId }, this.aad(s))).secret as string;
    const step = verifyTotp(secret, code, Date.now(), 0);
    if (step === null) { await this.fail(s, cred.failedAttempts); throw new UnauthorizedException(INVALID); }
    await this.db.prisma.mfaCredential.update({ where: this.where(s), data: { confirmedAt: new Date(), lastUsedStep: BigInt(step), failedAttempts: 0, lockedUntil: null } });
    const codes = await this.newRecoveryCodes(s);
    await this.log(s, 'auth.mfa_enabled', ip);
    return { recoveryCodes: codes };
  }

  private async newRecoveryCodes(s: { type: SubjectType; id: string }): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    await this.db.prisma.$transaction([
      this.db.prisma.mfaRecoveryCode.deleteMany({ where: { subjectType: s.type, subjectId: s.id } }),
      this.db.prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ subjectType: s.type, subjectId: s.id, codeHash: hashRecovery(c) })) }),
    ]);
    return codes; // plaintext is returned once; only hashes are stored
  }

  // ------------------------------------------------------------------ verification (login step-up, disable, regenerate)
  private async assertNotLocked(lockedUntil: Date | null) {
    if (lockedUntil && lockedUntil > new Date()) throw new HttpException({ code: 'mfa_locked', message: 'Too many incorrect codes. Try again in a few minutes.' }, HttpStatus.TOO_MANY_REQUESTS);
  }
  private async fail(s: { type: SubjectType; id: string }, current: number) {
    const n = current + 1;
    await this.db.prisma.mfaCredential.update({ where: this.where(s), data: n >= MAX_FAILS ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedAttempts: n } });
  }

  /** Throws unless `proof` is a valid, unused authenticator code or recovery code. Returns which was used. */
  async verify(s: MfaSubject, proof: MfaProof, ip: string | undefined): Promise<'totp' | 'recovery'> {
    const cred = await this.db.prisma.mfaCredential.findUnique({ where: this.where(s) });
    if (!cred?.confirmedAt) throw new UnauthorizedException(INVALID);
    await this.assertNotLocked(cred.lockedUntil);
    if (proof.recoveryCode) {
      // Atomic single use: of two simultaneous submissions of the same code exactly one claims it.
      const claimed = await this.db.prisma.mfaRecoveryCode.updateMany({ where: { subjectType: s.type, subjectId: s.id, codeHash: hashRecovery(proof.recoveryCode), usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) { await this.fail(s, cred.failedAttempts); await this.log(s, 'auth.mfa_failed', ip, { method: 'recovery' }); throw new UnauthorizedException(INVALID); }
      await this.db.prisma.mfaCredential.update({ where: this.where(s), data: { failedAttempts: 0, lockedUntil: null } });
      await this.log(s, 'auth.mfa_recovery_code_used', ip);
      return 'recovery';
    }
    const secret = (await this.box.open({ ciphertext: cred.ciphertext, wrappedKey: cred.wrappedKey, keyId: cred.keyId }, this.aad(s))).secret as string;
    const step = proof.code ? verifyTotp(secret, proof.code, Date.now(), Number(cred.lastUsedStep)) : null;
    // Compare-and-set on the last accepted step: two concurrent submissions of one code cannot both succeed (replay protection).
    const accepted = step !== null && (await this.db.prisma.mfaCredential.updateMany({ where: { subjectType: s.type, subjectId: s.id, lastUsedStep: { lt: BigInt(step) } }, data: { lastUsedStep: BigInt(step), failedAttempts: 0, lockedUntil: null } })).count === 1;
    if (!accepted) { await this.fail(s, cred.failedAttempts); await this.log(s, 'auth.mfa_failed', ip, { method: 'totp' }); throw new UnauthorizedException(INVALID); }
    return 'totp';
  }

  async disable(s: MfaSubject, proof: MfaProof, ip: string | undefined) {
    await this.verify(s, proof, ip);
    await this.db.prisma.$transaction([
      this.db.prisma.mfaRecoveryCode.deleteMany({ where: { subjectType: s.type, subjectId: s.id } }),
      this.db.prisma.mfaCredential.delete({ where: this.where(s) }),
    ]);
    await this.log(s, 'auth.mfa_disabled', ip);
  }

  async regenerateRecoveryCodes(s: MfaSubject, proof: MfaProof, ip: string | undefined) {
    await this.verify(s, proof, ip);
    const codes = await this.newRecoveryCodes(s);
    await this.log(s, 'auth.mfa_recovery_codes_regenerated', ip);
    return { recoveryCodes: codes };
  }

  // ------------------------------------------------------------------ login challenge (proof that the password step succeeded)
  async signChallenge(s: { type: SubjectType; id: string }): Promise<string> {
    const key = s.type === 'user' ? this.userKey : this.platformKey;
    if (!key) throw new Error('platform console disabled');
    return new SignJWT({ st: s.type }).setProtectedHeader({ alg: 'HS256' }).setSubject(s.id).setIssuer('leadpilot').setAudience(`mfa-challenge:${s.type}`).setIssuedAt().setExpirationTime(CHALLENGE_TTL).sign(key);
  }

  async readChallenge(token: string, type: SubjectType): Promise<string> {
    const key = type === 'user' ? this.userKey : this.platformKey;
    try {
      if (!key) throw new Error('disabled');
      const { payload } = await jwtVerify(token, key, { issuer: 'leadpilot', audience: `mfa-challenge:${type}`, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string') throw new Error('no subject');
      return payload.sub;
    } catch { throw new UnauthorizedException({ code: 'mfa_challenge_expired', message: 'Your sign-in expired. Sign in again.' }); }
  }
}

