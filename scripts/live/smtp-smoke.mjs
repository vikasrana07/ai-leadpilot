// Sends one real email through the configured SMTP provider using the API's own Mailer (STARTTLS/auth rules included).
//   SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... MAIL_FROM='LeadPilot <no-reply@yourdomain>' SMOKE_TO=you@domain NODE_ENV=production node scripts/live/smtp-smoke.mjs
import { createRequire } from 'node:module';
const { createTransport } = createRequire(new URL('../../apps/api/package.json', import.meta.url))('nodemailer');
import { check, finish, need } from './_lib.mjs';
need('SMTP_HOST', 'SMOKE_TO');
const port = Number(process.env.SMTP_PORT ?? 587);
const t = createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, ...(port === 465 ? {} : { requireTLS: true }), ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}) });
console.log('SMTP smoke');
await check('connect, negotiate TLS and authenticate', () => t.verify().then(() => 'ok'));
await check('send a test message', async () => (await t.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, to: process.env.SMOKE_TO, subject: 'LeadPilot SMTP smoke test', text: 'If you can read this, outbound email works.' })).messageId);
console.log('\nManual steps still needed: confirm it landed in the inbox (not spam), and check SPF/DKIM/DMARC alignment in the message headers; then trigger a real verification email from the app.');
finish();
