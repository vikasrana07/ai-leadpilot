import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiOrchestrator } from '../src/ai/orchestrator.js';
import { auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let orch: AiOrchestrator;
let owner: Account;
let other: Account;
const APP_SECRET = 'shadow-test-secret-123456';
const PHONE_ID = `75${String(parseInt(RUN, 16)).padStart(13, '0')}`.slice(0, 15);
let hook = '';
let n = 0;

const SHADOW_ASSISTANT = {
  enabled: true,
  name: 'Asha',
  businessIdentity: 'Skyline Realty',
  businessDescription: 'Homes in Pune.',
  languages: ['en'],
  tone: 'friendly',
  welcomeMessage: '',
  systemInstructions: '',
  workingHours: { enabled: false, days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
  handoverRules: { keywords: [], onNegotiation: true, onComplaint: true, shadowMode: true },
  allowedTools: ['get_business_info', 'handover_to_human'],
  model: null,
  temperature: 0.3,
  maxReplyChars: 600,
  fallbackMessage: 'A team member will reply shortly.',
  disclosureText: '',
  monthlyTokenCap: null,
};

const inbound = async (from: string, text: string) => {
  const b = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_ID },
          contacts: [{ wa_id: from, profile: { name: 'Shadow Visitor' } }],
          messages: [{ from, id: `wamid.SH${RUN}${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
        },
      }],
    }],
  });
  await ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(b).digest('hex')}`).send(b);
  await orch.idle();
};

beforeAll(async () => {
  ctx = await createTestApp();
  orch = ctx.app.get(AiOrchestrator);
  owner = await registerAccount(ctx, 'shOwner');
  other = await registerAccount(ctx, 'shOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({
    name: 'Shadow line',
    phoneNumberId: PHONE_ID,
    wabaId: `76${PHONE_ID.slice(2)}`,
    accessToken: 'EAAGshadowToken12345678901234',
    appSecret: APP_SECRET,
  });
  hook = new URL(ch.body.webhookUrl).pathname;
  expect((await ctx.http().put('/ai/assistant').set(auth(owner.accessToken)).send(SHADOW_ASSISTANT)).status).toBe(200);
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('Shadow-to-Live AI Auto-Pilot', () => {
  it('holds AI reply as a shadow draft instead of sending, then approves & updates trust stats', async () => {
    const from = `919820${String(parseInt(RUN, 16) % 1000000).padStart(6, '0')}`;
    await inbound(from, 'Hi, what are your office hours?');

    const list = await ctx.http().get(`/conversations?q=${from.slice(2)}&pageSize=5`).set(auth(owner.accessToken));
    const convoId = list.body.items[0].id as string;

    // 1. No outbound AI message should have been sent yet
    const msgsBefore = await ctx.http().get(`/conversations/${convoId}/messages`).set(auth(owner.accessToken));
    const aiMsgsBefore = (msgsBefore.body.items as { senderType: string }[]).filter((m) => m.senderType === 'AI');
    expect(aiMsgsBefore.length).toBe(0);

    // 2. Shadow draft is available for review
    const draftRes = await ctx.http().get(`/conversations/${convoId}/shadow-draft`).set(auth(owner.accessToken));
    expect(draftRes.status).toBe(200);
    expect(draftRes.body.runId).toBeTruthy();
    expect(typeof draftRes.body.draft).toBe('string');

    // Cross-tenant isolation check
    const otherRes = await ctx.http().get(`/conversations/${convoId}/shadow-draft`).set(auth(other.accessToken));
    expect(otherRes.status).toBe(404);

    // 3. Approve & Send the draft
    const approveRes = await ctx.http()
      .post(`/conversations/${convoId}/shadow-draft/review`)
      .set(auth(owner.accessToken))
      .send({ runId: draftRes.body.runId, action: 'approve' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('APPROVED');
    expect(approveRes.body.messageId).toBeTruthy();

    // 4. Outbound AI message is now sent & draft is cleared
    const msgsAfter = await ctx.http().get(`/conversations/${convoId}/messages`).set(auth(owner.accessToken));
    const aiMsgsAfter = (msgsAfter.body.items as { senderType: string }[]).filter((m) => m.senderType === 'AI');
    expect(aiMsgsAfter.length).toBe(1);

    const draftCleared = await ctx.http().get(`/conversations/${convoId}/shadow-draft`).set(auth(owner.accessToken));
    expect(draftCleared.body?.runId).toBeUndefined();

    // 5. Shadow stats reflect 100% accuracy (1/1 approved unchanged)
    const stats = await ctx.http().get('/ai/shadow-stats').set(auth(owner.accessToken));
    expect(stats.status).toBe(200);
    expect(stats.body.shadowMode).toBe(true);
    expect(stats.body.approvedUnchanged).toBe(1);
    expect(stats.body.accuracyPct).toBe(100);

    // 6. Go Live turns shadowMode off
    const goLive = await ctx.http().post('/ai/shadow-mode/go-live').set(auth(owner.accessToken));
    expect(goLive.status).toBe(200);
    expect(goLive.body.handoverRules.shadowMode).toBe(false);
  });
});
