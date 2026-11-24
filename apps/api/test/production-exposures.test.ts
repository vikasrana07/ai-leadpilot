import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { loadEnv } from '../src/config/env.js';
import { EmailTrackingService } from '../src/email-tracking/email-tracking.service.js';
import { MailService } from '../src/mail/mail.module.js';
import { FakeMail } from './helpers.js';

/**
 * Audit S-11 and S-13 (leftovers of TD-10): the interactive API docs were served in every environment, and the email tracking key fell
 * back to the session secret and then to a literal committed in source.
 */
const parse = (text: string) => Object.fromEntries(text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const example = parse(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

async function appWithEnv(over: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailService).useValue(new FakeMail()).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureApp(app, { ...loadEnv(), ...over } as ReturnType<typeof loadEnv>);
  await app.init();
  return app;
}

describe('interactive API docs', () => {
  it('are served outside production', async () => {
    const app = await appWithEnv({ NODE_ENV: 'development' });
    try { expect((await request(app.getHttpServer()).get('/docs')).status).toBe(200); } finally { await app.close(); }
  });

  it('are not served in production unless API_DOCS_ENABLED=true', async () => {
    const off = await appWithEnv({ NODE_ENV: 'production', API_DOCS_ENABLED: false });
    try { expect((await request(off.getHttpServer()).get('/docs')).status).toBe(404); } finally { await off.close(); }
    const on = await appWithEnv({ NODE_ENV: 'production', API_DOCS_ENABLED: true });
    try { expect((await request(on.getHttpServer()).get('/docs')).status).toBe(200); } finally { await on.close(); }
  });

  it('the public /v1 OpenAPI description stays available in production', async () => {
    const app = await appWithEnv({ NODE_ENV: 'production', API_DOCS_ENABLED: false });
    try { expect((await request(app.getHttpServer()).get('/v1/openapi.json')).status).toBe(200); } finally { await app.close(); }
  });
});

describe('email tracking signing key', () => {
  const service = (env: Record<string, unknown>) => new EmailTrackingService({} as never, env as never, {} as never);
  const payload = { e: 'email-1', t: 'tenant-1', type: 'open' };

  it('is derived from the session secret with domain separation, not the literal that used to be in source', () => {
    const a = service({ JWT_ACCESS_SECRET: 'j'.repeat(48) });
    const token = a.signToken(payload);
    expect(a.verifyToken(token)).toMatchObject(payload);
    // a service with another session secret cannot verify it, and neither can one keyed by the old literal
    expect(() => service({ JWT_ACCESS_SECRET: 'k'.repeat(48) }).verifyToken(token)).toThrow();
    expect(() => service({ TRACKING_SECRET: 'leadpilot-default-tracking-hmac-key-2026' }).verifyToken(token)).toThrow();
  });

  it('never signs with the session secret itself (a token forged with JWT_ACCESS_SECRET is rejected)', () => {
    const jwt = 'j'.repeat(48);
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forged = `${data}.${createHmac('sha256', jwt).update(data).digest('base64url')}`;
    expect(() => service({ JWT_ACCESS_SECRET: jwt }).verifyToken(forged)).toThrow();
  });

  it('uses TRACKING_SECRET when set, independent of the session secret', () => {
    const a = service({ TRACKING_SECRET: 's'.repeat(32), JWT_ACCESS_SECRET: 'j'.repeat(48) });
    const rotated = service({ TRACKING_SECRET: 's'.repeat(32), JWT_ACCESS_SECRET: 'z'.repeat(48) });
    expect(rotated.verifyToken(a.signToken(payload))).toMatchObject(payload); // JWT rotation does not break sent links
  });

  it('production refuses to boot without TRACKING_SECRET', () => {
    const prod = {
      ...example, JWT_ACCESS_SECRET: 'x'.repeat(48), LOCAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'), NODE_ENV: 'production', WEB_ORIGIN: 'https://app.example.test',
      WHATSAPP_MODE: 'live', EMBEDDED_SIGNUP_MODE: 'off', VIRUS_SCAN_MODE: 'clamav', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', KEY_PROVIDER: 'kms', KMS_KEY_ID: 'alias/test',
      TURNSTILE_MODE: 'live', TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k', RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's',
      RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24), SELLER_GSTIN: '29ABCDE1234F1Z5',
    };
    expect(() => loadEnv(prod)).toThrow(/TRACKING_SECRET is required in production/);
    expect(() => loadEnv({ ...prod, TRACKING_SECRET: 't'.repeat(32) })).not.toThrow();
  });
});
