// Captures screenshots of every screen into docs/screens/ (run against a running server):
//   BASE=http://localhost:8080 PW=yourpassword node scripts/screens.mjs
import { chromium } from 'playwright-core';
const base = process.env.BASE || 'http://localhost:8080';
const out = process.env.OUT || 'docs/screens';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto(base);
await page.screenshot({ path: `${out}/01-sign-in.png` });
await page.fill('input[autocomplete=name]', 'Designer');
await page.fill('input[type=password]', process.env.PW || 'impact');
await page.click('button[type=submit]');
await page.waitForSelector('text=New plaque job');
await page.screenshot({ path: `${out}/02-jobs.png` });
const jobHref = await page.$eval('ul a', (a) => a.getAttribute('href')).catch(() => null);
if (jobHref) {
  await page.goto(base + jobHref);
  await page.waitForSelector('text=Generate');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/03-workspace.png` });
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await m.addCookies(await ctx.cookies());
  const mp = await m.newPage();
  await mp.goto(base + jobHref);
  await mp.waitForTimeout(2000);
  await mp.screenshot({ path: `${out}/06-mobile.png` });
}
await page.goto(`${base}/admin?tab=assets`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/04-admin-assets.png`, fullPage: true });
await page.goto(`${base}/admin`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/05-admin-system.png` });
await browser.close();
console.log('screens saved to', out);
