import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractVoiceFields } from '../src/leads/lead-voice.service.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;
let agent: Account;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'vcOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'vcAgent', 'agent');
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('voice-to-crm', () => {
  it('extracts structured fields from Hinglish & English voice transcripts', () => {
    const res = extractVoiceFields('Namaste, met Rahul in Baner, wants 2 BHK flat, budget 80 lakh, follow up tomorrow.');
    expect(res.updates.location).toBe('Baner');
    expect(res.updates.propertyType).toBe('2 BHK');
    expect(res.updates.budgetMax).toBe(8_000_000);
    expect(res.suggestedTask?.title).toContain('Follow up:');
  });

  it('transcribes/extracts and atomically applies note, lead fields, and task', async () => {
    const lead = (
      await ctx.http().post('/leads').set(auth(owner.accessToken)).send({ name: 'Voice Lead', phone: '+919876599001' })
    ).body;

    // Upload fake audio buffer (uses MockVoiceTranscriptionProvider offline)
    const ext = await ctx
      .http()
      .post(`/leads/${lead.id}/voice-note`)
      .set(auth(owner.accessToken))
      .attach('file', Buffer.from('fake-webm-audio'), 'memo.webm');
    expect(ext.status).toBe(200);
    expect(ext.body.transcript).toContain('Baner');
    expect(ext.body.extraction.updates.budgetMax).toBe(8_000_000);

    // Apply extracted update
    const apply = await ctx
      .http()
      .post(`/leads/${lead.id}/voice-note/apply`)
      .set(auth(owner.accessToken))
      .send({
        note: ext.body.extraction.note,
        updates: ext.body.extraction.updates,
        task: { title: 'Follow up with Voice Lead' },
      });
    expect(apply.status).toBe(200);
    expect(apply.body.ok).toBe(true);
    expect(apply.body.taskId).toBeTruthy();

    // Verify lead updated
    const updated = await ctx.http().get(`/leads/${lead.id}`).set(auth(owner.accessToken));
    expect(updated.body.location).toBe('Baner');
    expect(updated.body.propertyType).toBe('2 BHK');
    expect(updated.body.budgetMax).toBe(8_000_000);

    // Agent without access gets 404
    expect(
      (
        await ctx
          .http()
          .post(`/leads/${lead.id}/voice-note`)
          .set(auth(agent.accessToken))
          .send({ transcript: 'hello' })
      ).status,
    ).toBe(404);
  });
});
