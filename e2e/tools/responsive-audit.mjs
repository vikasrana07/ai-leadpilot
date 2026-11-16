// Responsive/tap-target sweep over every page at phone and tablet sizes, in the installed Chrome. Not part of CI (needs a seeded account):
//   AUDIT_WEB=http://localhost:3500 AUDIT_API=http://localhost:4500 AUDIT_EMAIL=... AUDIT_PASSWORD=... [AUDIT_ADMIN_EMAIL/AUDIT_ADMIN_PASSWORD] node e2e/tools/responsive-audit.mjs
// Prints, per page and viewport: page-level horizontal overflow, elements poking past the viewport, and interactive elements smaller than 40px.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const WEB = process.env.AUDIT_WEB, API = process.env.AUDIT_API;
const out = process.env.AUDIT_OUT ?? '/tmp/polish'; mkdirSync(out, { recursive: true });
const viewports = [{ name: '375', width: 375, height: 812 }, { name: '768', width: 768, height: 1024 }];
const browser = await chromium.launch({ channel: 'chrome' });
async function sweep(label, creds, loginPath, pages) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const login = await ctx.request.post(`${API}${loginPath}`, { headers: { origin: WEB }, data: creds });
    if (login.status() !== 200) { console.log(`login failed for ${label}: ${login.status()}`); await ctx.close(); continue; }
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto(WEB + p, { waitUntil: 'networkidle' }).catch(() => undefined);
      await page.waitForTimeout(500);
      const r = await page.evaluate((w) => {
        const vis = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0; };
        const inScroller = (el) => { for (let n = el.parentElement; n && n !== document.body && n.id !== 'main'; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth) return true; } return false; };
        const doc = document.documentElement; const main = document.getElementById('main');
        const pageOverflow = doc.scrollWidth - doc.clientWidth;
        const mainOverflow = main ? main.scrollWidth - main.clientWidth : 0;
        const poking = [...document.querySelectorAll('body *')].filter((el) => vis(el) && !inScroller(el) && el.getBoundingClientRect().right > w + 1 && !el.closest('[aria-hidden="true"], .sr-only')).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''} "${(el.textContent || '').trim().slice(0, 24)}" right=${Math.round(el.getBoundingClientRect().right)}`);
        const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=checkbox]')].filter((el) => vis(el) && !el.closest('.sr-only')).filter((el) => { const b = el.getBoundingClientRect(); return b.height < 40 || b.width < 40; }).filter((el) => !(el.tagName === 'A' && el.closest('p, li, td, span') && el.getBoundingClientRect().height >= 16 && /inline/.test(getComputedStyle(el).display))).slice(0, 6).map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
        return { pageOverflow, mainOverflow, poking, small, smallCount: small.length };
      }, vp.width);
      const bad = r.pageOverflow > 0 || r.mainOverflow > 0 || r.poking.length > 0;
      console.log(`${bad ? 'OVERFLOW' : 'ok      '} ${vp.name} ${p}  pageΔ=${r.pageOverflow} mainΔ=${r.mainOverflow}${r.poking.length ? `  poking: ${r.poking.join(' | ')}` : ''}${r.smallCount ? `\n           small targets: ${r.small.join(' | ')}` : ''}`);
      await page.screenshot({ path: `${out}/${label}${p.replace(/[^a-z0-9]+/gi, '_')}-${vp.name}.png`, fullPage: false }).catch(() => undefined);
    }
    await ctx.close();
  }
}
const lead = process.env.AUDIT_LEAD_ID;
const app = ['/dashboard', '/leads', ...(lead ? [`/leads/${lead}`] : []), '/pipeline', '/inbox', '/properties', '/appointments', '/ai-assistant', '/knowledge', '/tasks', '/automations', '/reports', '/team', '/roles', '/integrations', '/billing', '/usage', '/audit', '/settings', '/security', '/api-keys', '/webhooks'];
await sweep('app', { email: process.env.AUDIT_EMAIL, password: process.env.AUDIT_PASSWORD }, '/auth/login', app);
if (process.env.AUDIT_ADMIN_EMAIL) await sweep('platform', { email: process.env.AUDIT_ADMIN_EMAIL, password: process.env.AUDIT_ADMIN_PASSWORD }, '/platform/auth/login', ['/platform', '/platform/tenants', '/platform/plans', '/platform/audit', '/platform/deletions', '/platform/security']);
await browser.close();
