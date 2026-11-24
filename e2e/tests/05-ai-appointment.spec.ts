import { expect, request as pwRequest, test } from '@playwright/test';
import { api, registerViaApi, signInViaApi, waSignature } from '../helpers.ts';

/**
 * Phase 5 gate, honest scope: a customer asks for a site visit over WhatsApp, the (MOCK) AI offers real free slots and books the one they
 * pick as PENDING, and the appointment is visible in the UI. NOT covered here: "reminder job scheduled". Reminders, the scanners and
 * the BullMQ retry/DLQ paths are covered at API level by apps/api/test/automation.test.ts and appointments.test.ts, with timezone/DST cases.
 * The model is the scripted mock: this proves the pipeline, not real LLM behaviour.
 */
const ASSISTANT = { enabled: true, name: 'Asha', businessIdentity: 'E2E Realty', businessDescription: 'Homes in Pune.', languages: ['en'], tone: 'friendly', welcomeMessage: '', systemInstructions: '', workingHours: { enabled: false, days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }, handoverRules: { keywords: [], onNegotiation: true, onComplaint: true }, allowedTools: ['get_business_info', 'update_lead', 'check_availability', 'create_appointment', 'handover_to_human'], model: null, temperature: 0.3, maxReplyChars: 600, fallbackMessage: 'A team member will reply shortly.', disclosureText: '', monthlyTokenCap: null };

test('AI books a site visit through real availability and it shows up as needing confirmation', async ({ page, request }) => {
  test.setTimeout(120_000); // the AI conversation takes several round trips
  const acct = await registerViaApi(request, 'ai');
  const secret = 'e2e-wa-secret-1234567890';
  const phoneId = `73${Date.now()}`.slice(0, 15);
  // a clean client for provider webhooks: the test `request` carries our session cookies (registration set them), which a real Meta call never would
  const meta = await pwRequest.newContext();
  const must = async <T extends { status: number }>(r: Promise<T>, ok = [200, 201]): Promise<T> => { const x = await r; expect(ok).toContain(x.status); return x; };

  await must(api(request, acct, 'put', '/appointments/availability', { membershipId: null, rules: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startMinute: 600, endMinute: 780 })) }));
  const ch = await must(api<{ webhookUrl: string }>(request, acct, 'post', '/channels/whatsapp', { name: 'E2E line', phoneNumberId: phoneId, wabaId: `74${phoneId.slice(2)}`, accessToken: 'EAAGe2eToken123456789012345', appSecret: secret }));
  const hook = new URL(ch.body.webhookUrl).pathname;
  await must(api(request, acct, 'put', '/ai/assistant', ASSISTANT));

  const from = `9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  let n = 0;
  const inbound = async (text: string) => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: from, profile: { name: 'Karan Customer' } }], messages: [{ from, id: `wamid.E2E${Date.now()}${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
    const res = await meta.post(`http://localhost:4100${hook}`, { headers: { 'content-type': 'application/json', 'x-hub-signature-256': waSignature(secret, body) }, data: body });
    expect(res.status(), await res.text()).toBe(200);
  };
  const conversationId = async () => { const r = await api<{ items: { id: string }[] }>(request, acct, 'get', `/conversations?q=${from.slice(2)}&pageSize=5`); return r.body.items[0]?.id; };
  const aiReplies = async () => { const id = await conversationId(); if (!id) return []; const r = await api<{ items: { senderType: string; body: string }[] }>(request, acct, 'get', `/conversations/${id}/messages`); return r.body.items.filter((m) => m.senderType === 'AI').map((m) => m.body); };

  await inbound('Hi, I want to book a site visit tomorrow');
  await expect.poll(async () => (await aiReplies()).at(-1) ?? '', { timeout: 30_000 }).toMatch(/free for a site visit/);
  const offered = [...((await aiReplies()).at(-1) as string).matchAll(/(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}) (AM|PM)/g)];
  expect(offered.length).toBeGreaterThanOrEqual(2);
  const pick = offered[1] as RegExpMatchArray;
  await inbound(`${pick[2]} ${pick[3]}`.replace(/^(\d{1,2}):00/, '$1') + ' works for me');
  await expect.poll(async () => (await aiReplies()).at(-1) ?? '', { timeout: 30_000 }).toMatch(/requested your site visit/);

  await meta.dispose();
  await signInViaApi(page, acct);
  await page.goto('/appointments');
  await page.getByRole('button', { name: 'Upcoming' }).click();
  const visit = page.getByRole('row', { name: /Karan Customer/ });
  await expect(visit).toBeVisible();
  await expect(visit).toContainText('Needs confirmation');
  await expect(visit.getByRole('button', { name: 'Confirm' })).toBeVisible(); // a person still has to confirm an AI booking
});
