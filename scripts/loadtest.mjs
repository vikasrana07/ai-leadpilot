// Dependency-free load/latency probe against a running API. Usage:
//   LOAD_EMAIL=... LOAD_PASSWORD=... node scripts/loadtest.mjs [http://localhost:4000]
// Measures p50/p95/max per endpoint (sequential), then concurrent throughput on the heaviest ones, and the WhatsApp webhook ACK time.
// It only READS (plus webhook posts into the workspace you point it at). Run it against a seeded, non-production workspace.
import { createHmac } from 'node:crypto';

const base = process.argv[2] ?? 'http://localhost:4000';
const email = process.env.LOAD_EMAIL, password = process.env.LOAD_PASSWORD;
if (!email || !password) throw new Error('Set LOAD_EMAIL and LOAD_PASSWORD');
const REPS = Number(process.env.LOAD_REPS ?? 20), CONC = Number(process.env.LOAD_CONC ?? 20);

const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token-delivery': 'body' }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { accessToken } = await login.json();
const H = { authorization: `Bearer ${accessToken}` };

const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
async function timed(path, init = {}) { const t = performance.now(); const r = await fetch(base + path, { ...init, headers: { ...H, ...(init.headers ?? {}) } }); await r.arrayBuffer(); return { ms: performance.now() - t, status: r.status }; }

const endpoints = [
  ['dashboard overview (30d)', '/analytics/overview?range=30d', 2000],
  ['dashboard overview (month)', '/analytics/overview?range=month', 2000],
  ['lead list (page 1)', '/leads?pageSize=25', 800],
  ['lead list sorted by score', '/leads?sort=score&pageSize=25', 800],
  ['lead search (name)', '/leads?q=Sharma&pageSize=25', 800],
  ['lead search (phone)', '/leads?q=9810000&pageSize=25', 800],
  ['lead filter hot+unassigned', '/leads?temperature=HOT&assigned=unassigned&pageSize=25', 800],
  ['pipeline board', '/pipeline/board', 1500],
  ['conversation list', '/conversations?pageSize=25', 800],
  ['appointments (month)', `/appointments?from=${new Date(Date.now() - 15 * 864e5).toISOString()}&to=${new Date(Date.now() + 15 * 864e5).toISOString()}`, 1000],
  ['usage', '/usage', 1000],
  ['team workload', '/team/workload', 1000],
];
const rows = [];
for (const [name, path, budget] of endpoints) {
  await timed(path); // warm-up
  const ms = []; let bad = 0;
  for (let i = 0; i < REPS; i++) { const r = await timed(path); ms.push(r.ms); if (r.status !== 200) bad++; }
  rows.push({ name, p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(...ms), budget, bad });
}
console.log('\nSequential (ms)'); console.log('endpoint'.padEnd(34), 'p50'.padStart(7), 'p95'.padStart(7), 'max'.padStart(7), 'budget'.padStart(7), ' result');
for (const r of rows) console.log(r.name.padEnd(34), r.p50.toFixed(0).padStart(7), r.p95.toFixed(0).padStart(7), r.max.toFixed(0).padStart(7), String(r.budget).padStart(7), r.bad ? ` ${r.bad} NON-200` : r.p95 <= r.budget ? ' ok' : ' OVER BUDGET');

async function concurrent(name, path, seconds = 8) {
  const ms = []; let bad = 0; const end = Date.now() + seconds * 1000;
  await Promise.all(Array.from({ length: CONC }, async () => { while (Date.now() < end) { const r = await timed(path); ms.push(r.ms); if (r.status !== 200) bad++; } }));
  console.log(`${name.padEnd(34)} ${CONC} workers: ${(ms.length / seconds).toFixed(0).padStart(5)} req/s  p50 ${pct(ms, 50).toFixed(0)}  p95 ${pct(ms, 95).toFixed(0)}  max ${Math.max(...ms).toFixed(0)} ms  non-200: ${bad}`);
}
console.log(`\nConcurrent (${CONC} workers, 8 s each)`);
await concurrent('dashboard overview (30d)', '/analytics/overview?range=30d');
await concurrent('lead list (page 1)', '/leads?pageSize=25');
await concurrent('lead search (name)', '/leads?q=Sharma&pageSize=25');

if (process.env.WA_HOOK_PATH && process.env.WA_APP_SECRET && process.env.WA_PHONE_ID) {
  const acks = []; let bad = 0;
  for (let i = 0; i < 40; i++) {
    const from = `9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: process.env.WA_PHONE_ID }, contacts: [{ wa_id: from, profile: { name: 'Load ' + i } }], messages: [{ from, id: `wamid.LOAD${Date.now()}${i}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hello from load test' } }] } }] }] });
    const t = performance.now();
    const r = await fetch(base + process.env.WA_HOOK_PATH, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', process.env.WA_APP_SECRET).update(body).digest('hex')}` }, body });
    await r.arrayBuffer(); acks.push(performance.now() - t); if (!r.ok) bad++;
  }
  console.log(`\nWebhook ACK (40 sequential): p50 ${pct(acks, 50).toFixed(0)}  p95 ${pct(acks, 95).toFixed(0)}  max ${Math.max(...acks).toFixed(0)} ms (budget 1000)  non-200: ${bad}`);
}
