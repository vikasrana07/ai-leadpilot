import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import crypto from 'node:crypto';
import { importJWK, SignJWT } from 'jose';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import { DbService } from '../db/db.module.js';

export interface PushSubInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

export interface PushPayload {
  id: string;
  title: string;
  body?: string | null;
  url?: string | null;
  tag?: string;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

/**
 * Encrypts a Web Push payload per RFC 8291 (`aes128gcm` content encoding) using Node's built-in `crypto`.
 */
export function encryptWebPushPayload(payload: Buffer, clientPublicKeyB64: string, authSecretB64: string): Buffer {
  const clientPub = b64urlToBuf(clientPublicKeyB64);
  const authSecret = b64urlToBuf(authSecretB64);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(clientPub);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), clientPub, serverPub]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  // Record padding: payload || 0x02 (last record delimiter)
  const plaintext = Buffer.concat([payload, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // aes128gcm header: salt (16) | rs (4, uint32BE = 4096) | idlen (1 = 65) | keyid (65)
  const header = Buffer.alloc(16 + 4 + 1 + serverPub.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPub.length, 20);
  serverPub.copy(header, 21);
  return Buffer.concat([header, ciphertext]);
}

@Injectable()
export class WebPushService {
  private readonly log = new Logger('WebPush');

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Optional() @Inject(ENV) private readonly env?: Env,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.env?.VAPID_PUBLIC_KEY && this.env?.VAPID_PRIVATE_KEY);
  }

  publicKey(): string | null {
    return this.isEnabled() ? (this.env?.VAPID_PUBLIC_KEY ?? null) : null;
  }

  async subscribe(tenantId: string, userId: string, input: PushSubInput) {
    return this.db.tenantTx({ tenantId, userId }, (tx) =>
      tx.pushSubscription.upsert({
        where: { userId_endpoint: { userId, endpoint: input.endpoint } },
        create: {
          tenantId,
          userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent?.slice(0, 300) ?? null,
        },
        update: {
          tenantId,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent?.slice(0, 300) ?? null,
        },
      }),
    );
  }

  async unsubscribe(tenantId: string, userId: string, endpoint: string): Promise<void> {
    await this.db.tenantTx({ tenantId, userId }, (tx) =>
      tx.pushSubscription.deleteMany({ where: { tenantId, userId, endpoint } }),
    );
  }

  private async signVapid(audience: string): Promise<string> {
    const pub = b64urlToBuf(this.env!.VAPID_PUBLIC_KEY!);
    const priv = b64urlToBuf(this.env!.VAPID_PRIVATE_KEY!);
    // Uncompressed P-256 public key is 0x04 || x (32) || y (32)
    const x = pub.subarray(1, 33).toString('base64url');
    const y = pub.subarray(33, 65).toString('base64url');
    const d = priv.toString('base64url');
    const key = await importJWK({ kty: 'EC', crv: 'P-256', x, y, d }, 'ES256');
    return new SignJWT({ sub: this.env?.VAPID_SUBJECT ?? 'mailto:support@leadpilot.local' })
      .setProtectedHeader({ typ: 'JWT', alg: 'ES256' })
      .setAudience(audience)
      .setExpirationTime('12h')
      .sign(key);
  }

  async sendToMemberships(
    tenantId: string,
    notifications: { id: string; membershipId: string; type: string; title: string; body?: string | null; link?: string | null }[],
  ): Promise<void> {
    if (!this.isEnabled() || notifications.length === 0) return;
    try {
      const mIds = [...new Set(notifications.map((n) => n.membershipId))];
      const memberships = await this.db.tenantTx({ tenantId }, (tx) =>
        tx.membership.findMany({ where: { tenantId, id: { in: mIds } }, select: { id: true, userId: true } }),
      );
      const userByMember = new Map(memberships.map((m) => [m.id, m.userId]));
      const userIds = [...new Set(memberships.map((m) => m.userId))];
      if (userIds.length === 0) return;

      const subs = await this.db.tenantTx({ tenantId }, (tx) =>
        tx.pushSubscription.findMany({ where: { tenantId, userId: { in: userIds } } }),
      );
      if (subs.length === 0) return;

      const expiredIds: string[] = [];
      for (const n of notifications) {
        const uid = userByMember.get(n.membershipId);
        if (!uid) continue;
        const userSubs = subs.filter((s) => s.userId === uid);
        const bodyBuf = Buffer.from(
          JSON.stringify({ id: n.id, title: n.title, body: n.body ?? '', url: n.link ?? '/dashboard', tag: n.type }),
          'utf8',
        );
        for (const sub of userSubs) {
          try {
            const origin = new URL(sub.endpoint).origin;
            const jwt = await this.signVapid(origin);
            const encrypted = encryptWebPushPayload(bodyBuf, sub.p256dh, sub.auth);
            const res = await fetch(sub.endpoint, {
              method: 'POST',
              headers: {
                Authorization: `vapid t=${jwt}, k=${this.env!.VAPID_PUBLIC_KEY!}`,
                'Content-Encoding': 'aes128gcm',
                'Content-Type': 'application/octet-stream',
                TTL: '86400',
              },
              body: new Uint8Array(encrypted),
            });
            if (res.status === 404 || res.status === 410) {
              expiredIds.push(sub.id);
            }
          } catch (e) {
            this.log.warn(`Web push send error: ${e instanceof Error ? e.message : 'unknown'}`);
          }
        }
      }

      if (expiredIds.length > 0) {
        await this.db.tenantTx({ tenantId }, (tx) =>
          tx.pushSubscription.deleteMany({ where: { tenantId, id: { in: expiredIds } } }),
        );
      }
    } catch (e) {
      this.log.warn(`Web push dispatch failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
