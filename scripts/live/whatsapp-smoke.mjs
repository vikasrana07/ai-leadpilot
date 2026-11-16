// Verifies the LIVE WhatsApp Cloud API client against a Meta test number / sandbox. Usage:
//   WA_PHONE_NUMBER_ID=... WA_ACCESS_TOKEN=... [WA_TO=<E.164 digits of a number allowed in the sandbox>] [WA_TEMPLATE=hello_world] node scripts/live/whatsapp-smoke.mjs
// Sends at most one text/template message, and only if WA_TO is set.
import { check, finish, need } from './_lib.mjs';
need('WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN');
const { LiveWhatsAppClient } = await import('../../apps/api/dist/whatsapp/whatsapp.client.js');
const c = new LiveWhatsAppClient({ WHATSAPP_GRAPH_VERSION: process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0' });
const creds = { accessToken: process.env.WA_ACCESS_TOKEN };
console.log('WhatsApp Cloud API smoke');
await check('read phone number info (token + number id are valid)', async () => { const i = await c.getPhoneNumber(process.env.WA_PHONE_NUMBER_ID, creds); return `${i.displayPhoneNumber} / quality ${i.qualityRating ?? 'n/a'}`; });
await check('an invalid token is rejected with a non-retryable error', async () => { try { await c.getPhoneNumber(process.env.WA_PHONE_NUMBER_ID, { accessToken: 'invalid' }); } catch (e) { if (e && e.retryable === false) return 'classified as non-retryable'; throw new Error(`unexpected error shape: ${e?.message}`, { cause: e }); } throw new Error('call unexpectedly succeeded'); });
await check('media host guard blocks a foreign host before any request', async () => { try { await c.downloadMedia(creds, 'https://example.com/x'); } catch (e) { if (/Unexpected media/.test(e.message)) return 'blocked'; throw e; } throw new Error('not blocked'); });
if (process.env.WA_TO) {
  await check('send a template message (opens the conversation)', async () => (await c.sendTemplate(process.env.WA_PHONE_NUMBER_ID, creds, process.env.WA_TO, process.env.WA_TEMPLATE ?? 'hello_world', 'en_US', [])).messageId);
  console.log('  note: a free-text message only works inside the 24 h window after the recipient replies; reply from the phone, then run with WA_TEXT=... to test sendText.');
  if (process.env.WA_TEXT) await check('send a text message (inside the 24 h window)', async () => (await c.sendText(process.env.WA_PHONE_NUMBER_ID, creds, process.env.WA_TO, process.env.WA_TEXT)).messageId);
} else console.log('  (set WA_TO to also test sending)');
console.log('\nManual steps still needed: (1) in Meta App > WhatsApp > Configuration set the webhook callback to <PUBLIC_API_URL>/webhooks/whatsapp/<key shown in Integrations> with the verify token; subscribe to `messages`; (2) message the number from a phone and confirm it appears in the Inbox, signature accepted; (3) check delivery/read receipts update message status; (4) send an image and open it (media path); (5) submit your real templates for approval in Meta Business Manager and register them in Integrations.');
finish();
