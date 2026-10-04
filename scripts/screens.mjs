// Drives the app end to end in a real browser and saves screenshots to docs/screens/:
// sign in, start example jobs, generate concepts (demo mode), pick one, create the proof
// and the vector PDF. Run against a running server (demo mode recommended):
//   BASE=http://localhost:8080 PW=yourpassword node scripts/screens.mjs
import { chromium } from 'playwright-core';

const base = process.env.BASE || 'http://localhost:8080';
const out = process.env.OUT || 'docs/screens';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120_000);

await page.goto(base);
await page.screenshot({ path: `${out}/01-sign-in.png` });
await page.fill('input[autocomplete=name]', 'Designer');
await page.fill('input[type=password]', process.env.PW || 'impact');
await page.click('button[type=submit]');
await page.waitForSelector('text=Start from an example');
await page.screenshot({ path: `${out}/02-jobs.png` });

async function runExample(jobNumber, shot) {
  await page.goto(base);
  await page.waitForSelector('text=Start from an example');
  const row = page.locator('li', { hasText: jobNumber }).filter({ has: page.locator('button', { hasText: 'Open' }) });
  await row.locator('button', { hasText: 'Open' }).click();
  await page.waitForSelector('text=Generate 3 concepts');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${shot}-a-order.png` });
  await page.click('button:has-text("Generate 3 concepts")');
  await page.waitForFunction(() => document.querySelectorAll('button').length && [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use this one')).length >= 3);
  await page.locator('button', { hasText: 'Use this one' }).first().click();
  await page.waitForSelector('text=Selected for proof');
  await page.click('button:has-text("Create proof PDF")');
  const ack = page.locator('button', { hasText: 'create proof anyway' });
  await page.waitForTimeout(800);
  if (await ack.count()) await ack.click();
  await page.waitForSelector('text=Latest');
  await page.click('button:has-text("Create vector PDF")');
  await page.waitForSelector('text=One ink');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${shot}-b-proof.png` });
  await page.screenshot({ path: `${out}/${shot}-c-full.png`, fullPage: true });
}

await runExample('32885', '03-raccoon-river');
await runExample('32249', '04-structure-of-merit');
await runExample('32582', '05-awe');

await page.goto(`${base}/admin?tab=assets`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/06-admin-assets.png`, fullPage: true });
await page.goto(`${base}/admin`);
await page.waitForSelector('text=Run a test image');
await page.click('button:has-text("Run a test image")');
await page.waitForSelector('text=OpenAI image generation works');
await page.screenshot({ path: `${out}/07-admin-system.png` });

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.addCookies(await ctx.cookies());
const mp = await m.newPage();
await mp.goto(base);
await mp.waitForTimeout(1500);
await mp.screenshot({ path: `${out}/08-mobile-jobs.png` });
await browser.close();
console.log('screens saved to', out);
