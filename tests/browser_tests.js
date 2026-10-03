// Screenshots + low-bandwidth test (ST-03). Requires: seeded DB (node server/seed.js), server running, Playwright + Chromium.
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
const db = require('../server/db');
const M = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function login(page, email) {
  await page.goto(BASE); await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'Demo1234');
  await page.click('button.btn.full'); await page.waitForSelector('.wrap');
}
const shot = async (page, name, fit = true) => {
  const h = fit ? await page.evaluate(() => document.documentElement.scrollHeight) : 900;
  await page.setViewportSize({ width: 390, height: Math.min(1800, Math.max(780, h)) }); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
};

(async () => {
  const browser = await chromium.launch();
  const res = { screenshots: [] };

  // ---- Figure 4.1: database schema rendered from the live MySQL catalogue
  {
    const [cols] = await db.query(`SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, COLUMN_KEY k, IS_NULLABLE n, EXTRA e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='tenant_landlord' ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    const [fks] = await db.query(`SELECT TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='tenant_landlord' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    const fkset = new Set(fks.map(f => f.t + '.' + f.c)); const by = {}; cols.forEach(c => (by[c.t] = by[c.t] || []).push(c));
    const order = ['Users', 'Properties', 'Tenancies', 'MaintenanceRequests', 'Messages', 'Notifications'];
    const box = t => `<div class="t"><div class="th">${t}</div>${by[t].map(c => `<div class="r"><span class="k">${c.k === 'PRI' ? 'PK' : fkset.has(t + '.' + c.c) ? 'FK' : ''}</span><b>${c.c}</b><i>${c.ty}${c.n === 'NO' ? ' NOT NULL' : ''}</i></div>`).join('')}</div>`;
    const html = `<style>body{font-family:system-ui,sans-serif;margin:0;padding:20px;background:#fff}h2{margin:0 0 12px;color:#0f766e;font-size:18px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.t{border:1px solid #0f766e;border-radius:6px;overflow:hidden;font-size:12.5px}.th{background:#0f766e;color:#fff;padding:6px 10px;font-weight:700}.r{display:flex;gap:6px;padding:3px 10px;border-top:1px solid #e5e7eb}.k{width:20px;color:#b45309;font-weight:700;font-size:11px}.r b{flex:1;font-weight:600}.r i{color:#6b7280;font-style:normal;font-size:11.5px}.rel{margin-top:14px;font-size:12.5px;color:#374151}.rel div{margin:2px 0}</style>
      <h2>Database: tenant_landlord (MySQL ${'8.0'}) — 6 tables, InnoDB, utf8mb4</h2><div class="g">${order.map(box).join('')}</div>
      <div class="rel"><b>Foreign-key relationships</b>${fks.map(f => `<div>${f.t}.${f.c} &rarr; ${f.rt}.${f.rc}</div>`).join('')}</div>`;
    const c0 = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 }); const p0 = await c0.newPage();
    await p0.setContent(html); await p0.screenshot({ path: path.join(OUT, 'db_schema.png'), fullPage: true }); await c0.close();
  }

  // ---- Auth screens
  let ctx = await browser.newContext(M); let page = await ctx.newPage();
  await page.goto(BASE); await page.waitForSelector('.auth'); await shot(page, 'login');
  await page.click('text=Create an account'); await page.selectOption('select', 'Tenant');
  await page.fill('input:not([type])', 'Amina Yusuf'); await page.fill('input[inputmode=numeric]', '08051234567');
  await page.fill('input[type=email]', 'amina.new@example.ng'); await page.fill('input[type=password]', 'Secret2026');
  await shot(page, 'register');
  await ctx.close();

  // ---- Tenant screens
  ctx = await browser.newContext(M); page = await ctx.newPage();
  await login(page, 'amina@demo.ng'); await page.waitForSelector('.card h3'); await shot(page, 'tenant_requests', false);
  await page.click('text=➕ New request'); await page.selectOption('select >> nth=0', 'Electrical'); await page.selectOption('select >> nth=1', 'High');
  await page.fill('textarea', 'The socket in the bedroom is hot to touch and smells of burning when the fan is plugged in.');
  await shot(page, 'tenant_new_request');
  await page.click('text=📋 My requests'); await page.click('.card:has-text("#1 ·")');
  await page.waitForSelector('.thread .msg'); await shot(page, 'request_thread');
  await page.click('text=🔔 Alerts'); await page.waitForSelector('.notif'); await page.evaluate(() => window.scrollTo(0, 0));
  // capture with badge visible: reload as new context state
  await shot(page, 'notifications');
  await ctx.close();

  // ---- Landlord screens
  ctx = await browser.newContext(M); page = await ctx.newPage();
  await login(page, 'landlord@demo.ng'); await page.waitForSelector('.card h3'); await shot(page, 'landlord_dashboard', false);
  await page.click('.card:has-text("#1 ·")'); await page.waitForSelector('.grid2'); await shot(page, 'landlord_request_detail');
  await page.click('text=📊 Reports'); await page.waitForSelector('.stat'); await shot(page, 'reports');
  await page.click('text=🏢 Properties'); await page.waitForSelector('.card h3'); await shot(page, 'properties');
  await ctx.close();

  // ---- Staff screen
  ctx = await browser.newContext(M); page = await ctx.newPage();
  await login(page, 'musa@demo.ng'); await page.waitForSelector('.card h3'); await page.click('.card >> nth=0'); await page.waitForSelector('.thread'); await shot(page, 'staff_job');
  await ctx.close();

  // ---- UI check for UT-01 role redirect
  const roles = {};
  for (const [email, expect] of [['amina@demo.ng', 'My requests'], ['landlord@demo.ng', 'Properties'], ['musa@demo.ng', 'My jobs']]) {
    ctx = await browser.newContext(M); page = await ctx.newPage(); await login(page, email);
    roles[email] = { expectTab: expect, found: (await page.locator('.tabs').innerText()).includes(expect) }; await ctx.close();
  }
  res.roleRedirect = roles;

  // ---- ST-03: low-bandwidth tests (cold cache, CDP throttling)
  const profiles = [{ name: 'Slow 3G (400 kbps, 400 ms latency)', down: 400, lat: 400 }, { name: '2G (250 kbps, 300 ms latency)', down: 250, lat: 300 }];
  res.lowBandwidth = [];
  for (const pr of profiles) {
    ctx = await browser.newContext(M); page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: pr.lat, downloadThroughput: pr.down * 1024 / 8, uploadThroughput: pr.down * 1024 / 8 });
    let bytes = 0; page.on('requestfinished', async r => { try { const s = await r.sizes(); bytes += s.responseBodySize + s.responseHeadersSize; } catch (e) { } });
    const t0 = Date.now(); await page.goto(BASE); await page.waitForSelector('input[type=email]'); const tLogin = Date.now() - t0;
    await page.fill('input[type=email]', 'amina@demo.ng'); await page.fill('input[type=password]', 'Demo1234');
    const t1 = Date.now(); await page.click('button.btn.full'); await page.waitForSelector('.hdr'); await page.waitForSelector('.wrap .card, .wrap .mut'); const tDash = Date.now() - t1;
    await page.click('text=➕ New request'); await page.selectOption('select >> nth=0', 'Plumbing'); await page.fill('textarea', 'Bathroom shower has very low water pressure since Monday.');
    const t2 = Date.now(); await page.click('button.btn.full'); await page.waitForSelector('.back'); await page.waitForSelector('.thread'); const tSubmit = Date.now() - t2;
    res.lowBandwidth.push({ profile: pr.name, login_page_s: +(tLogin / 1000).toFixed(2), dashboard_after_login_s: +(tDash / 1000).toFixed(2), submit_request_s: +(tSubmit / 1000).toFixed(2), transferred_kb: +(bytes / 1024).toFixed(1) });
    await ctx.close();
  }
  await browser.close();

  res.files = fs.readdirSync(OUT); fs.writeFileSync(path.join(__dirname, 'results', 'browser_results.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2)); await db.end();
})().catch(e => { console.error(e); process.exit(1); });
