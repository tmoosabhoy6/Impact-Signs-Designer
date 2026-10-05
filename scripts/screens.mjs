// Drives the app end to end in a real browser and saves screenshots to docs/screens/:
// sign in, start example jobs, generate concepts (demo mode), pick one, create the proof
// and the vector PDF. Run against a running server (demo mode recommended):
//   BASE=http://localhost:8080 PW=yourpassword node scripts/screens.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

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
  if (jobNumber === '32249') await perConceptFiles();
}

// A proof and a vector file from the two layouts that are not selected, from their own columns.
async function perConceptFiles() {
  for (const name of ['Feature Image', 'Statement']) {
    const column = page.locator('article').filter({ has: page.locator('h3', { hasText: name }) });
    await column.getByRole('button', { name: 'Proof PDF' }).click();
    await column.getByRole('link', { name: `Proof - 32249 - ${name}.pdf`, exact: true }).waitFor();
    await column.getByRole('button', { name: 'Vector PDF' }).click();
    await column.getByTitle(new RegExp(`_${name.replace(' ', '_')}_production\\.pdf$`)).waitFor();
  }
  // Selection stays on the first concept; the right panel lists every file by layout.
  await page.locator('article').filter({ hasText: 'Selected for proof' }).filter({ has: page.locator('h3', { hasText: 'Classic' }) }).waitFor();
  await page.getByText('Statement v1').first().waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/15-per-concept-files.png` });
  await page.screenshot({ path: `${out}/16-per-concept-files-full.png`, fullPage: true });
}

await runExample('32885', '03-raccoon-river');
await runExample('32249', '04-structure-of-merit');
await runExample('32582', '05-awe');

// Several photos, logos and sketches on one job, through the file pickers.
async function runMultiFiles() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pps-screens-'));
  const logo = async (name, hue, shape) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#fff"/>${shape(`hsl(${hue},55%,28%)`)}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(tmp, name));
    return path.join(tmp, name);
  };
  const logos = [
    await logo('county-seal.png', 210, (c) => `<circle cx="300" cy="150" r="120" fill="${c}"/><circle cx="300" cy="150" r="70" fill="#fff"/>`),
    await logo('rotary.png', 20, (c) => `<rect x="60" y="70" width="480" height="160" rx="30" fill="${c}"/><rect x="120" y="120" width="360" height="60" fill="#fff"/>`),
    await logo('foundation.png', 140, (c) => `<polygon points="300,30 560,270 40,270" fill="${c}"/><polygon points="300,120 440,240 160,240" fill="#fff"/>`),
  ];
  const { examples } = await (await ctx.request.get(`${base}/api/examples`)).json();
  const ex = examples.find((e) => e.jobNumber === '32241');
  const { project } = await (await ctx.request.post(`${base}/api/examples/${ex.id}`, { data: {} })).json();
  await page.goto(`${base}/jobs/${project.id}`);
  await page.waitForSelector('text=Generate 3 concepts');
  // Two more photos in one pick, then three logos and two sketches.
  await page.getByLabel('Choose photos').setInputFiles(['references/31882-honeywell/photo.png', 'references/32717-camp-southern-ground/photo.png']);
  await page.getByText('3 of 4').waitFor();
  await page.getByLabel('Choose logos').setInputFiles(logos);
  await page.getByText('3 of 6').waitFor();
  await page.getByLabel('Choose sketches').setInputFiles(['references/sketch-examples/charlies-field-sketch.pdf', logos[0]]);
  await page.locator('li', { hasText: 'county-seal.png' }).nth(1).waitFor();
  // The same file again is refused with its name.
  await page.getByLabel('Choose logos').setInputFiles([logos[1]]);
  await page.getByText('rotary.png was not added').waitFor();
  // Reorder and remove: the third photo goes, the last logo moves to the left.
  await page.getByRole('button', { name: 'Remove photo.png' }).last().click();
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label="Remove photo.png"]').length === 1);
  await page.getByRole('button', { name: 'Move foundation.png left' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('li')].map((l) => l.textContent).join('|').match(/county-seal\.png.*foundation\.png.*rotary\.png/));
  await page.waitForTimeout(800);
  await page.locator('section', { hasText: 'Customer files' }).screenshot({ path: `${out}/12-multi-files.png` });
  await page.click('button:has-text("Generate 3 concepts")');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use this one')).length >= 3);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/13-multi-concepts.png` });
  await page.locator('button', { hasText: 'Use this one' }).first().click();
  await page.waitForSelector('text=Selected for proof');
  await page.click('button:has-text("Create proof PDF")');
  await page.waitForSelector('text=Latest');
  await page.click('button:has-text("Create vector PDF")');
  await page.waitForSelector('text=One ink');
  await page.getByText('All 3 traced to vector').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/14-multi-proof.png` });
  fs.rmSync(tmp, { recursive: true, force: true });
}
await runMultiFiles();

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
