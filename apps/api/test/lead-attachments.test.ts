import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EICAR, MockScanner, VIRUS_SCANNER } from '../src/ai/knowledge/virus-scan.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/ai/knowledge/storage.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;
let agent: Account;
let otherOwner: Account;
let memberIds: Record<string, string> = {};

const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'attOwner');
  otherOwner = await registerAccount(ctx, 'attOther');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'attAgent', 'agent');
  const members = await ctx.http().get('/team/members').set(auth(owner.accessToken));
  memberIds = Object.fromEntries(members.body.map((m: { user: { email: string }; id: string }) => [m.user.email, m.id]));
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('lead attachments', () => {
  it('uploads, lists, downloads, and deletes a valid PDF attachment', async () => {
    const leadRes = await ctx
      .http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({ name: 'Attachment Lead', phone: '+919876500001' });
    expect(leadRes.status).toBe(201);
    const leadId = leadRes.body.id as string;

    const up = await ctx
      .http()
      .post(`/leads/${leadId}/attachments`)
      .set(auth(owner.accessToken))
      .attach('file', fakePdf, 'brochure.pdf');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ leadId, filename: 'brochure.pdf', mime: 'application/pdf', sizeBytes: fakePdf.length });

    const list = await ctx.http().get(`/leads/${leadId}/attachments`).set(auth(owner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const dl = await ctx.http().get(`/leads/${leadId}/attachments/${up.body.id}/download`).set(auth(owner.accessToken));
    expect(dl.status).toBe(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).toContain('brochure.pdf');
    expect(Buffer.from(dl.body).equals(fakePdf)).toBe(true);

    const del = await ctx.http().delete(`/leads/${leadId}/attachments/${up.body.id}`).set(auth(owner.accessToken));
    expect(del.status).toBe(204);

    const after = await ctx.http().get(`/leads/${leadId}/attachments`).set(auth(owner.accessToken));
    expect(after.body).toHaveLength(0);
  });

  it('rejects unsupported file types, magic-byte mismatches, and EICAR virus signatures (fail closed)', async () => {
    const leadRes = await ctx
      .http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({ name: 'Validation Lead', phone: '+919876500002' });
    const leadId = leadRes.body.id as string;

    const badExt = await ctx
      .http()
      .post(`/leads/${leadId}/attachments`)
      .set(auth(owner.accessToken))
      .attach('file', Buffer.from('MZ...'), 'evil.exe');
    expect(badExt.status).toBe(400);
    expect(badExt.body.error.code).toBe('unsupported_file_type');

    const badMagic = await ctx
      .http()
      .post(`/leads/${leadId}/attachments`)
      .set(auth(owner.accessToken))
      .attach('file', Buffer.from('not really a pdf'), 'fake.pdf');
    expect(badMagic.status).toBe(400);
    expect(badMagic.body.error.code).toBe('invalid_file_content');

    const infected = await ctx
      .http()
      .post(`/leads/${leadId}/attachments`)
      .set(auth(owner.accessToken))
      .attach('file', Buffer.from(EICAR), 'eicar.txt');
    expect(infected.status).toBe(400);
    expect(infected.body.error.code).toBe('infected_file');

    const scanner = ctx.app.get<MockScanner>(VIRUS_SCANNER);
    scanner.unavailable = true;
    try {
      const down = await ctx
        .http()
        .post(`/leads/${leadId}/attachments`)
        .set(auth(owner.accessToken))
        .attach('file', fakePdf, 'clean.pdf');
      expect(down.status).toBe(503);
    } finally {
      scanner.unavailable = false;
    }
  });

  it('enforces agent row-scoping and cross-tenant isolation (404)', async () => {
    const leadRes = await ctx
      .http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({ name: 'Owner Only Lead', phone: '+919876500003', assignedMembershipId: memberIds[owner.email] });
    const leadId = leadRes.body.id as string;

    const up = await ctx
      .http()
      .post(`/leads/${leadId}/attachments`)
      .set(auth(owner.accessToken))
      .attach('file', fakePdf, 'secret.pdf');
    expect(up.status).toBe(201);

    // Agent assigned to someone else's lead gets 404
    expect((await ctx.http().get(`/leads/${leadId}/attachments`).set(auth(agent.accessToken))).status).toBe(404);
    expect(
      (await ctx.http().post(`/leads/${leadId}/attachments`).set(auth(agent.accessToken)).attach('file', fakePdf, 'x.pdf')).status,
    ).toBe(404);
    expect(
      (await ctx.http().delete(`/leads/${leadId}/attachments/${up.body.id}`).set(auth(agent.accessToken))).status,
    ).toBe(404);

    // Other tenant gets 404
    expect((await ctx.http().get(`/leads/${leadId}/attachments`).set(auth(otherOwner.accessToken))).status).toBe(404);
    expect(
      (await ctx.http().get(`/leads/${leadId}/attachments/${up.body.id}/download`).set(auth(otherOwner.accessToken))).status,
    ).toBe(404);
  });

  it('re-parents attachments when leads are merged', async () => {
    const target = await ctx
      .http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({ name: 'Merge Target', phone: '+919876500004' });
    const source = await ctx
      .http()
      .post('/leads')
      .set(auth(owner.accessToken))
      .send({ name: 'Merge Source', phone: '+919876500005' });

    const up = await ctx
      .http()
      .post(`/leads/${source.body.id}/attachments`)
      .set(auth(owner.accessToken))
      .attach('file', fakePdf, 'source-doc.pdf');
    expect(up.status).toBe(201);

    const merged = await ctx
      .http()
      .post(`/leads/${target.body.id}/merge`)
      .set(auth(owner.accessToken))
      .send({ sourceIds: [source.body.id] });
    expect(merged.status).toBe(200);

    const list = await ctx.http().get(`/leads/${target.body.id}/attachments`).set(auth(owner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.map((a: { filename: string }) => a.filename)).toContain('source-doc.pdf');

    // Clean up S3 object
    const storage = ctx.app.get<ObjectStorage>(OBJECT_STORAGE);
    await storage.deletePrefix(`tenants/${owner.tenantId}/leads/`).catch(() => undefined);
  });
});
