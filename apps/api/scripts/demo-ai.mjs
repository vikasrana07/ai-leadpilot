// DEV ONLY. Sends signed WhatsApp webhooks as a customer chatting with the AI assistant (mock WhatsApp + mock AI).
import { createHmac } from 'node:crypto';
const API = process.env.API_URL ?? 'http://localhost:4000';
const login = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token-delivery': 'body' }, body: JSON.stringify({ email: process.argv[2] ?? 'priya@skyline.demo.test', password: process.argv[3] ?? 'Demo-Passw0rd!' }) })).json();
const auth = { authorization: `Bearer ${login.accessToken}` };
const channels = await (await fetch(API + '/channels', { headers: auth })).json();
if (!channels.length) throw new Error('Run scripts/demo-whatsapp.mjs first');
const hook = new URL(channels[0].webhookUrl).pathname;
const APP_SECRET = 'demo-app-secret-12345';
const from = process.argv[4] ?? '919811200001';
const text = process.argv[5] ?? 'Hi, do you have a 3BHK in Wakad under 1.5 crore? I want to buy within a month.';
const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '100200300400500' }, contacts: [{ wa_id: from, profile: { name: 'Neha Sharma' } }], messages: [{ from, id: `wamid.AIDEMO${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
const r = await fetch(API + hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex') }, body });
console.log('webhook ->', r.status, '| customer:', text);
