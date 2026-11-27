import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapSheetRowsToLeads } from '../src/integrations/google-sheets/google-sheets.service.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, type Account, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: Account;
let agent: Account;

beforeAll(async () => {
  ctx = await createTestApp();
  owner = await registerAccount(ctx, 'gsOwner');
  await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token });
  agent = await addMember(ctx, owner, 'gsAgent', 'agent');
});

afterAll(async () => {
  await ctx.close();
  await cleanup();
});

describe('google sheets sync', () => {
  it('maps spreadsheet rows to lead payloads and skips rows without contact info', () => {
    const mapped = mapSheetRowsToLeads(
      ['Full Name', 'Mobile', 'Email', 'City'],
      [
        ['Asha Verma', '+91 98765 43210', 'asha@example.com', 'Pune'],
        ['No Contact', '', '', 'Mumbai'],
        ['', '9811122233', '', 'Delhi'],
      ],
      { name: 'Full Name', phone: 'Mobile', email: 'Email', location: 'City' },
    );

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ name: 'Asha Verma', phone: '+91 98765 43210', email: 'asha@example.com', location: 'Pune' });
    expect(mapped[1]).toMatchObject({ name: 'Google Sheet Lead', phone: '9811122233', location: 'Delhi' });
  });

  it('enforces integration:manage permission on google sheets endpoints', async () => {
    expect((await ctx.http().get('/integrations/google-sheets').set(auth(owner.accessToken))).status).toBe(200);
    expect((await ctx.http().get('/integrations/google-sheets').set(auth(agent.accessToken))).status).toBe(403);
  });
});
