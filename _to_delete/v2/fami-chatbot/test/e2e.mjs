// Spuštění: MOCK=1 PORT=3111 node server.js &  then  node test/e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3111';
const OUT = process.env.OUT || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'cs-CZ' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// 1) inline stránka
await page.goto(BASE + '/');
const sh = page.locator('#fami-widget');
const ta = sh.locator('textarea');
await ta.waitFor();
await page.waitForFunction(() => document.querySelector('#fami-widget').shadowRoot.querySelectorAll('.m.a').length >= 1);
await ta.fill('Tatínek se vrátil z nemocnice a potřebujeme zajistit péči');
await ta.press('Enter');
await page.waitForFunction(() => document.querySelector('#fami-widget').shadowRoot.querySelectorAll('.card').length >= 1);
await page.waitForFunction(() => !document.querySelector('#fami-widget').shadowRoot.querySelector('[data-a=send]').disabled, null, { timeout: 20000 });
await page.waitForTimeout(300);
await ta.fill('Jsme ze Zlína');
await ta.press('Enter');
await page.waitForFunction(() => document.querySelector('#fami-widget').shadowRoot.querySelectorAll('.card').length >= 2);
await page.waitForFunction(() => !document.querySelector('#fami-widget').shadowRoot.querySelector('[data-a=send]').disabled, null, { timeout: 20000 });
await page.waitForTimeout(300);
const cards = await page.evaluate(() => [...document.querySelector('#fami-widget').shadowRoot.querySelectorAll('.card')].map((c) => ({ region: c.querySelector('.rg').textContent, links: c.querySelectorAll('a[href*="service="]').length })));
console.log('cards:', JSON.stringify(cards));
await page.screenshot({ path: OUT + '/fami-inline.png', fullPage: false });

// reload → historie ze sessionStorage
await page.reload();
await page.waitForFunction(() => document.querySelector('#fami-widget').shadowRoot.querySelectorAll('.card').length >= 2);
console.log('history restored after reload: OK');

// 2) plovoucí widget na demo stránce
await page.goto(BASE + '/demo-embed.html');
const fab = sh.locator('.fab');
await fab.waitFor();
await page.screenshot({ path: OUT + '/fami-embed-closed.png' });
await page.click('button.cta');
await page.waitForFunction(() => document.querySelector('#fami-widget').shadowRoot.querySelector('.panel.open'));
await page.waitForFunction(() => document.querySelector('#fami-widget').shadowRoot.querySelectorAll('.card').length >= 1);
await page.waitForFunction(() => !document.querySelector('#fami-widget').shadowRoot.querySelector('[data-a=send]').disabled, null, { timeout: 20000 });
await page.waitForTimeout(300);
const ev = await page.textContent('#ev');
console.log('host event:', ev);
await page.screenshot({ path: OUT + '/fami-embed-open.png' });

// 3) mobil
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/fami-mobile.png' });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
