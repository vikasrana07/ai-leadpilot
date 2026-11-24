#!/usr/bin/env node
/**
 * Master Live Provider Verification Runner.
 * Scans environment variables for provider credentials, runs available smoke checks,
 * and outputs an executive readiness scorecard.
 *
 * Usage:
 *   node scripts/live/run-all.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROVIDERS = [
  {
    name: 'OpenAI (LLM & Embeddings)',
    script: 'openai-smoke.mjs',
    envVars: ['OPENAI_API_KEY'],
    optionalEnvVars: ['AI_CHAT_MODEL', 'AI_EMBEDDING_MODEL'],
  },
  {
    name: 'WhatsApp Cloud API (Meta)',
    script: 'whatsapp-smoke.mjs',
    envVars: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TEST_RECIPIENT'],
    optionalEnvVars: ['WHATSAPP_WABA_ID'],
  },
  {
    name: 'Razorpay (Subscriptions & GST Invoices)',
    script: 'razorpay-smoke.mjs',
    envVars: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
  },
  {
    name: 'SMTP / SES (Transactional Mail)',
    script: 'smtp-smoke.mjs',
    envVars: ['SMTP_HOST', 'SMTP_PORT'],
  },
];

console.log('='.repeat(70));
console.log(' LeadPilot AI — Live Provider Verification Runner');
console.log('='.repeat(70));

const results = [];

for (const prov of PROVIDERS) {
  const missing = prov.envVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.log(`\n[-] Skipping ${prov.name}: missing ${missing.join(', ')}`);
    results.push({ name: prov.name, status: 'SKIPPED', detail: `Missing ${missing.join(', ')}` });
    continue;
  }

  console.log(`\n[*] Running verification for ${prov.name}...`);
  const code = await new Promise((resolve) => {
    const child = spawn('node', [join(__dirname, prov.script)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', resolve);
  });

  if (code === 0) {
    results.push({ name: prov.name, status: 'PASSED' });
  } else {
    results.push({ name: prov.name, status: 'FAILED', detail: `Exit code ${code}` });
  }
}

console.log('\n' + '='.repeat(70));
console.log(' Verification Summary');
console.log('='.repeat(70));

for (const r of results) {
  const badge = r.status === 'PASSED' ? '\x1b[32m[PASS]\x1b[0m' : r.status === 'SKIPPED' ? '\x1b[33m[SKIP]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`  ${badge} ${r.name.padEnd(45)} ${r.detail ?? ''}`);
}

const passed = results.filter((r) => r.status === 'PASSED').length;
const totalConfigured = results.filter((r) => r.status !== 'SKIPPED').length;

console.log('\nResult: ' + `${passed}/${totalConfigured} configured providers verified live.`);
if (totalConfigured === 0) {
  console.log('Notice: No external provider credentials were found in the current environment.');
  console.log('To verify live providers, populate the required credentials in .env.local or your CI secret store.');
}
console.log('='.repeat(70) + '\n');
