import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KnowledgeService } from '../src/ai/knowledge/knowledge.service.js';
import { AiOrchestrator } from '../src/ai/orchestrator.js';
import { addMember, auth, cleanup, createTestApp, registerAccount, RUN, type Account, type TestCtx } from './helpers.js';
import { CASES, type EvalCase } from './eval/cases.js';

const LIVE = process.env.EVAL_LIVE === '1';
const APP_SECRET = 'eval-app-secret-1234567'; const PHONE_ID = '600700800900100';
let ctx: TestCtx; let owner: Account; let owner$: pg.Pool; let orch: AiOrchestrator; let hook = ''; let n = 0;
const results: { id: string; group: string; ok: boolean; note?: string }[] = [];

const webhook = (from: string, texts: string[]) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: from, profile: { name: 'Eval Customer' } }], messages: texts.map((t) => ({ from, id: `wamid.EV${RUN}${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: t } })) } }] }] });

beforeAll(async () => {
  ctx = await createTestApp(); orch = ctx.app.get(AiOrchestrator); owner$ = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  owner = await registerAccount(ctx, 'evOwner'); await ctx.http().post('/auth/verify-email').send({ token: ctx.mail.last('verify', owner.email)?.token }); await addMember(ctx, owner, 'evAgent', 'agent');
  const ch = await ctx.http().post('/channels/whatsapp').set(auth(owner.accessToken)).send({ name: 'Eval line', phoneNumberId: PHONE_ID, wabaId: '100200300400500', accessToken: 'EAAGevalTestToken12345678901', appSecret: APP_SECRET });
  hook = new URL(ch.body.webhookUrl).pathname;
  const props = [{ title: '3 BHK in Wakad', bedrooms: 3, price: 11_200_000 }, { title: '2 BHK in Wakad', bedrooms: 2, price: 8_200_000 }, { title: '3 BHK sold unit', bedrooms: 3, price: 9_900_000, status: 'SOLD' }];
  for (const p of props) await ctx.http().post('/properties').set(auth(owner.accessToken)).send({ project: 'Greenfield Heights', propertyType: 'Apartment', location: 'Wakad', ...p });
  await ctx.http().post('/knowledge/documents').set(auth(owner.accessToken)).attach('file', Buffer.from('Home loan documents: you need identity proof, address proof and the last six months of salary slips.\n\nParking policy: two covered slots per unit.'), { filename: 'faq.txt', contentType: 'text/plain' });
  await ctx.app.get(KnowledgeService).idle();
  await ctx.http().put('/ai/assistant').set(auth(owner.accessToken)).send({ enabled: true, name: 'Asha', businessIdentity: 'Skyline Realty', businessDescription: 'Premium homes in Pune.', languages: ['en', 'hinglish', 'hi'], tone: 'friendly', welcomeMessage: '', systemInstructions: '', workingHours: { enabled: false, days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }, handoverRules: { keywords: ['human', 'real person', 'call me', 'इंसान'], onNegotiation: true, onComplaint: true }, allowedTools: ['get_business_info', 'search_properties', 'get_lead_details', 'update_lead', 'calculate_lead_score', 'create_followup', 'handover_to_human'], model: null, temperature: 0.2, maxReplyChars: 600, fallbackMessage: 'Thanks! A team member will reply shortly.', disclosureText: '', monthlyTokenCap: null });
});
afterAll(async () => {
  const by = (g: string) => results.filter((r) => r.group === g);
  const lines = [...new Set(results.map((r) => r.group))].map((g) => `  ${g.padEnd(13)} ${by(g).filter((r) => r.ok).length}/${by(g).length}`);
  process.stderr.write(`\nAI eval (${LIVE ? 'LIVE model' : 'offline heuristic mock'}): ${results.filter((r) => r.ok).length}/${results.length} passed, ${CASES.length - results.length} skipped (live-only)\n${lines.join('\n')}\n`);
  await orch.idle(); await owner$.end(); await ctx.close(); await cleanup();
});

const runnable = CASES.filter((c) => LIVE || !c.live);

describe(`golden conversations (${LIVE ? 'live model' : 'offline mock'})`, () => {
  it('has at least 30 cases defined across all groups, with unique ids', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    expect(new Set(CASES.map((c) => c.group)).size).toBe(7);
    expect(runnable.length).toBeGreaterThanOrEqual(LIVE ? 30 : 20);
  });

  it.each(runnable.map((c) => [c.id, c] as [string, EvalCase]))('%s', async (_id, c) => {
    const phone = `9190000${String(++n).padStart(5, '0')}`;
    const b = webhook(phone, c.say);
    await ctx.http().post(hook).set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(b).digest('hex')}`).send(b);
    await orch.idle();
    const convo = (await ctx.http().get(`/conversations?q=${phone.slice(2)}`).set(auth(owner.accessToken))).body.items[0];
    const msgs = (await ctx.http().get(`/conversations/${convo.id}/messages`).set(auth(owner.accessToken))).body.items as { senderType: string; direction: string; body: string }[];
    const replies = msgs.filter((m) => m.senderType === 'AI').map((m) => m.body ?? '').join('\n');
    const rows = (await owner$.query('SELECT trace FROM ai_runs WHERE conversation_id=$1', [convo.id])).rows as { trace: { tools: { name: string }[] } }[];
    const toolsUsed = rows.flatMap((r) => r.trace.tools.map((t) => t.name));
    const lead = (await ctx.http().get(`/leads/${convo.lead.id}`).set(auth(owner.accessToken))).body;
    const execs = (await owner$.query('SELECT e.tool, e.input, e.status FROM ai_tool_executions e JOIN ai_runs r ON r.id = e.run_id WHERE r.conversation_id=$1', [convo.id])).rows;
    const fails: string[] = [];
    if (process.env.EVAL_DEBUG) process.stderr.write(`\n[${c.id}] msgs=${JSON.stringify(msgs.map((m) => `${m.direction[0]}:${m.body}`))} execs=${JSON.stringify(execs)}\n`);
    const e = c.expect;
    for (const t of e.tools ?? []) if (!toolsUsed.includes(t)) fails.push(`expected tool ${t}, used [${toolsUsed.join(', ')}]`);
    for (const t of e.noTools ?? []) if (toolsUsed.includes(t)) fails.push(`must not call ${t}`);
    for (const [k, v] of Object.entries(e.lead ?? {})) if (lead[k] !== v) fails.push(`lead.${k} = ${JSON.stringify(lead[k])}, expected ${JSON.stringify(v)}`);
    if (e.handover !== undefined && (convo.mode === 'HUMAN') !== e.handover) fails.push(`handover expected ${e.handover}`);
    for (const x of e.replyIncludes ?? []) if (!(x instanceof RegExp ? x.test(replies) : replies.includes(x))) fails.push(`reply missing ${String(x)}`);
    for (const x of e.replyExcludes ?? []) if (x instanceof RegExp ? x.test(replies) : replies.includes(x)) fails.push(`reply contains forbidden ${String(x)}`);
    if (e.noReply && replies) fails.push('expected no reply');
    results.push({ id: c.id, group: c.group, ok: fails.length === 0, note: fails.join('; ') });
    expect(fails, `${c.id} (${c.group}): tools=[${toolsUsed.join(',')}] runs=${rows.length} reply was: ${replies.slice(0, 200)}`).toEqual([]);
  });
});
