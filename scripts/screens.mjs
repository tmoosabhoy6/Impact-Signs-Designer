// Captures screenshots of every screen into docs/screens/ (run against a running server):
//   BASE=http://localhost:8080 PW=yourpassword node scripts/screens.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base = process.env.BASE || 'http://localhost:8080';
const out = process.env.OUT || 'docs/screens';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto(base);
await page.screenshot({ path: `${out}/01-sign-in.png` });
await page.fill('input[autocomplete=name]', 'Designer');
await page.fill('input[type=password]', process.env.PW || 'impact');
await page.click('button[type=submit]');
await page.waitForSelector('text=New plaque job');
await page.screenshot({ path: `${out}/02-jobs.png` });
const jobHref = process.env.JOB_ID ? `/jobs/${process.env.JOB_ID}` : await page.$eval('ul a', (a) => a.getAttribute('href')).catch(() => null);
if (jobHref) {
  await page.goto(base + jobHref);
  await page.waitForSelector('text=Generate');
  await page.getByRole('heading', { name: 'Concepts', exact: true }).waitFor();
  if (!await page.getByLabel('Describe a fix for this image').count()) {
    await page.getByRole('button', { name: 'Generate 3 concepts', exact: true }).click();
    await page.getByLabel('Describe a fix for this image').first().waitFor({ timeout: 600_000 });
  }
  await page.screenshot({ path: `${out}/03-workspace.png` });
  // This is an actual edit, not a screenshot-only mock. In live mode it incurs
  // one image call. Use an example verification job, never a customer's order.
  const column = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Classic', exact: true }) });
  await column.getByLabel('Describe a fix for this image').fill('make the border double line');
  await column.getByRole('button', { name: 'Apply', exact: true }).click();
  await column.getByRole('status').filter({ hasText: 'Interpreted as:' }).waitFor({ timeout: 90_000 });
  await column.getByRole('button', { name: 'Undo order change', exact: true }).waitFor({ timeout: 600_000 });
  await column.getByRole('button', { name: 'Apply', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled, undefined, { timeout: 600_000 });
  await column.screenshot({ path: `${out}/07-fix-plan.png` });
  await column.getByLabel('Describe a fix for this image').fill('use a purple anodized finish');
  await column.getByRole('button', { name: 'Apply', exact: true }).click();
  await column.getByLabel('Available alternatives').waitFor({ timeout: 90_000 });
  await column.screenshot({ path: `${out}/08-fix-refusal.png` });
  await column.getByRole('button', { name: 'Undo order change', exact: true }).click();
  await column.getByRole('button', { name: 'Apply', exact: true }).waitFor();
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await m.addCookies(await ctx.cookies());
  const mp = await m.newPage();
  await mp.goto(base + jobHref);
  await mp.getByRole('heading', { name: 'Concepts', exact: true }).waitFor();
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
