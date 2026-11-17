// axe-core sweep of the main pages in light and dark themes on a running stack (same env as responsive-audit.mjs). Prints violations.
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const WEB = process.env.AUDIT_WEB, API = process.env.AUDIT_API;
const pages = ['/dashboard', '/leads', `/leads/${process.env.AUDIT_LEAD_ID}`, '/pipeline', '/inbox', '/properties', '/appointments', '/ai-assistant', '/knowledge', '/tasks', '/automations', '/automations/new', ...(process.env.AUDIT_AUTOMATION_ID ? [`/automations/${process.env.AUDIT_AUTOMATION_ID}/edit`] : []), '/reports', '/team', '/roles', '/integrations', '/billing', '/usage', '/audit', '/settings', '/security', '/api-keys', '/webhooks'];
const browser = await chromium.launch({ channel: 'chrome' });
const totals = new Map();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  await ctx.request.post(`${API}/auth/login`, { headers: { origin: WEB }, data: { email: process.env.AUDIT_EMAIL, password: process.env.AUDIT_PASSWORD } });
  const page = await ctx.newPage();
  const list = [...pages, ...(scheme === 'light' ? ['__login'] : [])];
  for (const p of list) {
    if (p === '__login') { const c2 = await browser.newContext({ colorScheme: scheme }); const pg = await c2.newPage(); await pg.goto(WEB + '/login'); await pg.waitForLoadState('networkidle'); const r = await new AxeBuilder({ page: pg }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); report('/login', scheme, r); await c2.close(); continue; }
    await page.goto(WEB + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    report(p, scheme, await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze());
  }
  await ctx.close();
}
function report(p, scheme, r) {
  for (const v of r.violations) { const k = `${v.id} (${v.impact})`; totals.set(k, (totals.get(k) ?? 0) + 1); console.log(`${scheme} ${p}: ${v.id} [${v.impact}] x${v.nodes.length} ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ').slice(0, 160)}`); }
  if (!r.violations.length) console.log(`${scheme} ${p}: clean`);
}
if (process.env.AUDIT_ADMIN_EMAIL) for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  await ctx.request.post(`${API}/platform/auth/login`, { headers: { origin: WEB }, data: { email: process.env.AUDIT_ADMIN_EMAIL, password: process.env.AUDIT_ADMIN_PASSWORD } });
  const page = await ctx.newPage();
  for (const p of ['/platform', '/platform/tenants', '/platform/plans', '/platform/audit', '/platform/deletions', '/platform/security']) { await page.goto(WEB + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(400); report(p, scheme, await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()); }
  await page.goto(WEB + '/platform/login'); report('/platform/login', scheme, await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze());
  await ctx.close();
}
console.log('\nTotals', Object.fromEntries(totals));
await browser.close();
