// Drives the app end to end in a real browser and saves screenshots to docs/screens/:
// sign in, start example jobs, generate concepts (demo mode), pick one, create the proof
// and the vector PDF. Run against a running server (demo mode recommended):
//   BASE=http://localhost:8080 PW=yourpassword node scripts/screens.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.env.BASE || 'http://localhost:8080';
const out = process.env.OUT || 'docs/screens';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120_000);

await page.goto(base);
await page.screenshot({ path: `${out}/01-sign-in.png` });
await page.fill('input[autocomplete=name]', 'Designer');
await page.fill('input[type=password]', process.env.PW || 'impact');
await page.click('button[type=submit]');
await page.waitForSelector('text=New plaque job');
const mode = await (await ctx.request.get(`${base}/api/me`)).json();
if (!mode.mock) throw new Error('Run this screenshot regression against MOCK_AI=1. Use verify-live.mjs for paid live checks.');
await page.screenshot({ path: `${out}/02-jobs.png` });

async function runExample(jobNumber, shot) {
  // Examples are not in the app UI; create the job through the API and open it.
  const { examples } = await (await ctx.request.get(`${base}/api/examples`)).json();
  const ex = examples.find((e) => e.jobNumber === jobNumber);
  if (!ex) throw new Error(`No example for job ${jobNumber}`);
  const { project } = await (await ctx.request.post(`${base}/api/examples/${ex.id}`, { data: {} })).json();
  await page.goto(`${base}/jobs/${project.id}`);
  await page.waitForSelector('text=Generate 3 concepts');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${shot}-a-order.png` });
  await page.click('button:has-text("Generate 3 concepts")');
  await page.waitForFunction(() => document.querySelectorAll('button').length && [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use this one')).length >= 3);
  if (jobNumber === '32885') {
    const column = page.locator('article').filter({ has: page.locator('h3', { hasText: 'Classic' }) });
    await column.getByLabel('Describe a fix for this image').fill('make the border double line');
    await column.getByRole('button', { name: 'Apply', exact: true }).click();
    await column.getByRole('status').filter({ hasText: 'Interpreted as:' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
    await column.screenshot({ path: `${out}/09-fix-plan.png` });
    await column.getByLabel('Describe a fix for this image').fill('use a purple anodized finish');
    await column.getByRole('button', { name: 'Apply', exact: true }).click();
    await column.getByLabel('Available alternatives').waitFor();
    await column.screenshot({ path: `${out}/10-fix-refusal.png` });
    await column.getByRole('button', { name: 'Undo order change', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
  }
  await page.locator('button', { hasText: 'Use this one' }).first().click();
  await page.waitForSelector('text=Selected for proof');
  await page.click('button:has-text("Create proof PDF")');
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
const mobileJobsWidth = await mp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
if (mobileJobsWidth.scroll > mobileJobsWidth.view) throw new Error(`Mobile jobs overflow: ${JSON.stringify(mobileJobsWidth)}`);
await mp.screenshot({ path: `${out}/08-mobile-jobs.png` });
const firstJob = mp.locator('a[href^="/jobs/"]').first();
await firstJob.click();
await mp.getByRole('button', { name: /^Generate 3 (new )?concepts$/ }).waitFor();
const mobileWorkspaceWidth = await mp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
if (mobileWorkspaceWidth.scroll > mobileWorkspaceWidth.view) throw new Error(`Mobile workspace overflow: ${JSON.stringify(mobileWorkspaceWidth)}`);
await mp.screenshot({ path: `${out}/11-mobile-workspace.png` });
await browser.close();
console.log('screens saved to', out);
