// Opens the main dialogs / drawer at phone size and checks they fit the viewport and are scrollable when tall. Same env as responsive-audit.mjs.
import { chromium } from '@playwright/test';
const WEB = process.env.AUDIT_WEB, API = process.env.AUDIT_API, out = process.env.AUDIT_OUT ?? '/tmp/polish';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
await ctx.request.post(`${API}/auth/login`, { headers: { origin: WEB }, data: { email: process.env.AUDIT_EMAIL, password: process.env.AUDIT_PASSWORD } });
const page = await ctx.newPage();
const cases = [
  ['/leads', 'Add lead'], ['/leads', 'Import'], ['/tasks', 'New task'], ['/appointments', 'Book'], ['/api-keys', 'Create API key'], ['/webhooks', 'Add endpoint'], ['/billing', 'Billing details'],
  ['/team', 'Invite'], ['/knowledge', 'Upload'], ['/properties', 'Add'], ['/automations', null],
];
for (const [path, name] of cases) {
  await page.goto(WEB + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  if (!name) continue;
  const btn = page.getByRole('button', { name: new RegExp(name, 'i') }).first();
  if (!(await btn.count())) { console.log(`skip     ${path} "${name}": no such button`); continue; }
  await btn.click().catch(() => undefined); await page.waitForTimeout(400);
  const dlg = page.getByRole('dialog').first();
  if (!(await dlg.count())) { console.log(`no-dialog ${path} "${name}"`); continue; }
  const r = await dlg.evaluate((el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), vh: innerHeight, vw: innerWidth, overflowY: s.overflowY, scrollable: el.scrollHeight > el.clientHeight }; });
  const fits = r.top >= 0 && r.bottom <= r.vh && r.left >= 0 && r.right <= r.vw;
  const ok = fits || (r.overflowY !== 'visible');
  console.log(`${ok ? 'ok      ' : 'CLIPPED '} ${path} "${name}" dialog ${r.left},${r.top}-${r.right},${r.bottom} of ${r.vw}x${r.vh} overflowY=${r.overflowY}`);
  await page.screenshot({ path: `${out}/dlg${path.replace(/\W+/g, '_')}-${name.replace(/\W+/g, '')}.png` });
  await page.keyboard.press('Escape');
}
// drawer
await page.goto(WEB + '/dashboard', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400);
console.log('drawer nav visible:', await page.getByRole('navigation', { name: 'Main' }).isVisible());
await page.screenshot({ path: `${out}/drawer.png` });
await browser.close();
