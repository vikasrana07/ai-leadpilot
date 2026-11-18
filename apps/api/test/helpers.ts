import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { loadEnv } from '../src/config/env.js';
import { MailService } from '../src/mail/mail.module.js';

export interface SentMail { to: string; kind: 'verify' | 'reset' | 'invite' | 'exists' | 'billing' | 'mfa_reset' | 'alert'; token?: string; subject?: string; text?: string }

export class FakeMail {
  sent: SentMail[] = [];
  sendVerification = async (to: string, token: string) => void this.sent.push({ to, kind: 'verify', token });
  sendPasswordReset = async (to: string, token: string) => void this.sent.push({ to, kind: 'reset', token });
  sendInvitation = async (to: string, token: string) => void this.sent.push({ to, kind: 'invite', token });
  sendBilling = async (to: string, subject: string) => void this.sent.push({ to, kind: 'billing', subject });
  sendMfaReset = async (to: string) => void this.sent.push({ to, kind: 'mfa_reset' });
  sendAlert = async (to: string, subject: string, text?: string) => void this.sent.push({ to, kind: 'alert', subject, ...(text !== undefined ? { text } : {}) });
  sendAccountExists = async (to: string) => void this.sent.push({ to, kind: 'exists' });
  last(kind: SentMail['kind'], to: string): SentMail | undefined {
    return [...this.sent].reverse().find((m) => m.kind === kind && m.to === to);
  }
}

export const RUN = randomUUID().slice(0, 8);
export const PASSWORD = 'Str0ngPassw0rd!';
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3100';

export interface TestCtx { app: INestApplication; mail: FakeMail; http: () => ReturnType<typeof request>; close: () => Promise<void> }

export async function createTestApp(overrides: { provide: unknown; useValue: unknown }[] = []): Promise<TestCtx> {
  const mail = new FakeMail();
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailService).useValue(mail);
  for (const o of overrides) builder = builder.overrideProvider(o.provide as never).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureApp(app, loadEnv());
  await app.init();
  const server = app.getHttpServer() as Parameters<typeof request>[0];
  return { app, mail, http: () => request(server), close: () => app.close() };
}

export interface Account { email: string; accessToken: string; refreshToken: string; userId: string; tenantId: string }

export async function registerAccount(ctx: TestCtx, label: string, industry = 'real_estate'): Promise<Account> {
  const email = `it-${RUN}-${label}@example.test`.toLowerCase();
  const res = await ctx.http().post('/auth/register').set('x-token-delivery', 'body')
    .send({ name: `User ${label}`, email, password: PASSWORD, businessName: `Biz ${label} ${RUN}`, industry });
  if (res.status !== 201 || !res.body.accessToken) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, userId: res.body.user.id, tenantId: res.body.activeTenantId };
}

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Invite `email` into the owner's workspace and accept it as a new user. Returns the new member's account. */
export async function addMember(ctx: TestCtx, owner: Account, label: string, roleKey: 'manager' | 'agent'): Promise<Account> {
  const email = `it-${RUN}-${label}@example.test`.toLowerCase();
  const inv = await ctx.http().post('/team/invitations').set(auth(owner.accessToken)).send({ email, roleKey });
  if (inv.status !== 201) throw new Error(`invite failed ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = ctx.mail.last('invite', email)?.token;
  if (!token) throw new Error('no invite mail');
  const acc = await ctx.http().post('/auth/invitations/accept').set('x-token-delivery', 'body').send({ token, name: `User ${label}`, password: PASSWORD });
  if (acc.status !== 200) throw new Error(`accept failed ${acc.status} ${JSON.stringify(acc.body)}`);
  return { email, accessToken: acc.body.accessToken, refreshToken: acc.body.refreshToken, userId: acc.body.user.id, tenantId: acc.body.activeTenantId };
}

export async function cleanup(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  try {
    const like = `it-${RUN}-%`;
    const t = await pool.query(`SELECT DISTINCT m.tenant_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email LIKE $1`, [like]);
    const ids = t.rows.map((r) => r.tenant_id as string);
    for (const t of ['data_exports', 'tenant_deletion_requests', 'subscriptions', 'billing_profiles', 'invoices', 'payments', 'appointment_events', 'appointments', 'automation_runs', 'automations', 'tasks', 'notifications', 'notification_preferences', 'sla_breaches', 'event_marks', 'availability_rules', 'availability_exceptions', 'outbox_events', 'ai_tool_executions', 'ai_runs', 'knowledge_chunks', 'knowledge_documents', 'lead_scores', 'scoring_rule_sets', 'ai_assistants', 'messages', 'conversation_notes', 'conversations', 'webhook_events', 'consents', 'widget_configs', 'channels', 'integration_credentials', 'whatsapp_templates']) await pool.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [ids]);
    await pool.query('DELETE FROM leads WHERE tenant_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM invitations WHERE tenant_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM audit_logs WHERE tenant_id = ANY($1) OR actor_user_id IN (SELECT id FROM users WHERE email LIKE $2)', [ids, like]);
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [ids]);
    await pool.query("DELETE FROM billing_events WHERE event_id LIKE $1", [`it-${RUN}-%`]);
    await pool.query('DELETE FROM platform_audit_logs WHERE admin_id IN (SELECT id FROM platform_admins WHERE email LIKE $1) OR tenant_id = ANY($2)', [like, ids]);
    await pool.query('DELETE FROM platform_admins WHERE email LIKE $1', [like]);
    await pool.query("DELETE FROM plans WHERE key ~ '^it_'");
    await pool.query('DELETE FROM users WHERE email LIKE $1', [like]);
  } finally {
    await pool.end();
  }
}

/**
 * True when ANOTHER process sharing this database (an e2e server, `apps/worker`, a dev or background API started with WORKERS_ENABLED=true) is
 * consuming outbox events. Such a process claims events of every workspace, relays them and drains webhook deliveries with ITS settings (private
 * targets blocked, its own retry limits), so tests that drive the relay or the webhook dispatcher themselves cannot trust the outcome.
 * Nothing in the calling test process may be draining the outbox yet: it inserts probe events for `tenantId` and any claim of them is foreign.
 */
export async function foreignOutboxConsumerPresent(pool: pg.Pool, tenantId: string, windowMs = 3000): Promise<boolean> {
  const ids = (await Promise.all(Array.from({ length: 3 }, async () => (await pool.query<{ id: string }>(`INSERT INTO outbox_events (id, tenant_id, type, payload) VALUES (gen_random_uuid(), $1, 'test.noop', '{}') RETURNING id`, [tenantId])).rows[0]!.id)));
  let foreign = false;
  for (let waited = 0; waited < windowMs && !foreign; waited += 100) {
    await new Promise((r) => setTimeout(r, 100));
    foreign = ((await pool.query<{ n: number }>(`SELECT count(*)::int n FROM outbox_events WHERE id = ANY($1::uuid[]) AND status <> 'pending'`, [ids])).rows[0]?.n ?? 0) > 0;
  }
  await pool.query(`DELETE FROM outbox_events WHERE id = ANY($1::uuid[])`, [ids]);
  return foreign;
}
