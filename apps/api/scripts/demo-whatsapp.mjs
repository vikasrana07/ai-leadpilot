// DEV ONLY. Connects a MOCK WhatsApp number to a demo workspace (WHATSAPP_MODE=mock) and delivers correctly signed
// webhook payloads, exactly as Meta would. Usage: node scripts/demo-whatsapp.mjs [email] [password]
import { createHmac } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:4000';
const email = process.argv[2] ?? 'priya@skyline.demo.test';
const password = process.argv[3] ?? 'Demo-Passw0rd!';
const APP_SECRET = 'demo-app-secret-12345';
const PHONE_ID = '100200300400500';

const j = async (path, init = {}) => {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};

const login = await j('/auth/login', { method: 'POST', headers: { 'x-token-delivery': 'body' }, body: JSON.stringify({ email, password }) });
if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
const auth = { authorization: `Bearer ${login.body.accessToken}` };

let channels = (await j('/channels', { headers: auth })).body;
if (!channels.length) {
  const c = await j('/channels/whatsapp', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Demo WhatsApp (mock)', phoneNumberId: PHONE_ID, wabaId: '200300400500600', accessToken: 'EAAGdemoMockAccessToken1234567890', appSecret: APP_SECRET }) });
  if (c.status !== 201) throw new Error(`connect failed: ${JSON.stringify(c.body)}`);
  channels = [c.body];
  console.log('Connected mock WhatsApp channel');
}
const hook = new URL(channels[0].webhookUrl).pathname;

const now = () => String(Math.floor(Date.now() / 1000));
let n = Date.now();
async function inbound(from, name, text) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000', phone_number_id: PHONE_ID }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id: `wamid.DEMO${n++}`, timestamp: now(), type: 'text', text: { body: text } }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
  const r = await fetch(API + hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
  return r.status;
}

const script = [
  ['919811100001', 'Meera Pillai', ['Hi, I saw your ad for Greenfield Heights', 'Is a 3BHK available? My budget is around 1.2 crore', 'We want to move within two months']],
  ['919811100002', 'Arun Bhatia', ['Can I get the brochure for Lakeview Residency?']],
  ['919811100003', 'Zoya Khan', ['Hello', 'Do you have 2BHK in Baner under 90 lakhs?']],
];
for (const [from, name, msgs] of script) for (const m of msgs) console.log(from, m.slice(0, 40), '->', await inbound(from, name, m));
console.log('Done. Open http://localhost:3100/inbox');
