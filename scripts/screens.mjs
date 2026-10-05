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
  await page.waitForSelector('text=Generate 2 concepts');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${shot}-a-order.png` });
  // Quality and resolution are fixed on the server.
  const generation = page.waitForRequest((r) => r.url().endsWith(`/projects/${project.id}/generate`) && r.method() === 'POST');
  await page.click('button:has-text("Generate 2 concepts")');
  if ('quality' in (await generation).postDataJSON()) throw new Error('Generation settings must be fixed by the server.');
  await page.waitForFunction(() => document.querySelectorAll('button').length && [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use this one')).length >= 2);
  if (jobNumber === '32885') {
    const column = page.locator('article').filter({ has: page.locator('h3', { hasText: 'Classic' }) });
    await column.getByLabel('Describe a change for this image').fill('make the border double line');
    const editing = page.waitForRequest((r) => r.url().endsWith('/fix') && r.method() === 'POST');
    await column.getByRole('button', { name: 'Apply', exact: true }).click();
    if ('quality' in (await editing).postDataJSON()) throw new Error('Fix quality must be fixed by the server.');
    await column.getByRole('status').filter({ hasText: 'Interpreted as:' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
    await column.screenshot({ path: `${out}/09-fix-plan.png` });
    await column.getByRole('button', { name: 'Undo order change', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
    // Nothing is refused: a request the catalog cannot hold goes to the image model as written.
    await column.getByLabel('Describe a change for this image').fill('use a purple anodized finish');
    await column.getByRole('button', { name: 'Apply', exact: true }).click();
    await column.getByRole('status').filter({ hasText: 'Sent to the image model as written' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
    await column.screenshot({ path: `${out}/10-fix-image-edit.png` });
  }
  await page.locator('button', { hasText: 'Use this one' }).first().click();
  await page.waitForSelector('article[aria-current="true"] button:has-text("On the proof")');
  await page.click('button:has-text("Create proof PDF")');
  await page.waitForSelector('text=Latest');
  await page.click('button:has-text("Create vector PDF")');
  await page.waitForSelector('text=One ink');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${shot}-b-proof.png` });
  await page.screenshot({ path: `${out}/${shot}-c-full.png`, fullPage: true });
  if (jobNumber === '32249') await perConceptFiles();
}

// One proof of two images: "Add as page" under the other concepts, then one PDF with a page each.
async function perConceptFiles() {
  for (const [i, name] of ['Statement'].entries()) {
    const column = page.locator('article').filter({ has: page.locator('h3', { hasText: name }) });
    await column.getByRole('button', { name: `Add as page ${i + 2}` }).click();
    await column.getByRole('button', { name: 'On the proof · remove' }).waitFor();
  }
  await page.waitForFunction(() => document.querySelectorAll('article[aria-current="true"]').length === 2);
  await page.locator('aside').last().getByText('On the proof · 2 pages').waitFor();
  await page.click('button:has-text("Create 2-page proof PDF")');
  await page.locator('aside').last().getByText('Proof - 32249 - Classic + Statement v2.pdf').waitFor();
  await page.locator('aside').last().getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.locator('aside').last().getByText('From Classic v1 + Statement v1').first().waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/15-two-page-proof.png` });
  await page.screenshot({ path: `${out}/16-two-page-proof-full.png`, fullPage: true });
  // The full-size viewer: zoom in with the wheel and drag.
  await page.locator('article').filter({ has: page.locator('h3', { hasText: 'Classic' }) }).getByRole('button', { name: 'View full size' }).click();
  const viewer = page.getByRole('dialog');
  await viewer.getByText('100%').first().waitFor();
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(650, 380, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/17-viewer-zoom.png` });
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'hidden' });
  // The panels resize by dragging their handles; a double-click lets them follow the work again.
  const handle = page.getByRole('separator', { name: 'Resize the order panel' });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const asideWidth = await page.locator('aside').first().evaluate((el) => el.getBoundingClientRect().width);
  if (asideWidth < box.x + 120) throw new Error(`Order panel did not widen: ${asideWidth}`);
  await page.screenshot({ path: `${out}/18-panels-resized.png` });
  await handle.dblclick();
  await page.waitForTimeout(600);
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
  await page.waitForSelector('text=Generate 2 concepts');
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
  // Each logo keeps its own side; a save must not move its neighbours.
  for (const [name, position] of [['county-seal.png', 'top'], ['foundation.png', 'left'], ['rotary.png', 'right']]) {
    const saved = page.waitForResponse((r) => r.url().endsWith('/placement') && r.ok());
    await page.getByLabel(`Position of ${name}`).selectOption(position);
    await saved;
  }
  for (const treatment of ['uv-print-mono', 'uv-print', 'raised-cast']) {
    const saved = page.waitForResponse((r) => r.url().endsWith(`/projects/${project.id}`) && r.request().method() === 'PATCH' && r.ok());
    await page.getByLabel('Logo treatment', { exact: true }).selectOption(treatment);
    await saved;
  }
  await page.waitForTimeout(800);
  await page.locator('section', { hasText: 'Customer files' }).screenshot({ path: `${out}/12-multi-files.png` });
  // Quality and resolution are fixed on the server.
  const generation = page.waitForRequest((r) => r.url().endsWith(`/projects/${project.id}/generate`) && r.method() === 'POST');
  await page.click('button:has-text("Generate 2 concepts")');
  if ('quality' in (await generation).postDataJSON()) throw new Error('Generation settings must be fixed by the server.');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use this one')).length >= 2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/13-multi-concepts.png` });
  await page.locator('button', { hasText: 'Use this one' }).first().click();
  await page.waitForSelector('article[aria-current="true"] button:has-text("On the proof")');
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

// The Vectorizer: a photo of a finished plaque becomes a one-ink vector PDF of its logo.
await page.goto(`${base}/vectorizer`);
await page.waitForSelector('text=Make vector PDF');
await page.setInputFiles('input[type=file]', 'assets/logo-treatments/uv-print.png');
await page.click('button:has-text("Make vector PDF")');
await page.getByText('Download vector PDF').waitFor();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/19-vectorizer.png` });

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
await mp.getByRole('button', { name: /^Generate 2 (new )?concepts$/ }).waitFor();
const mobileWorkspaceWidth = await mp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
if (mobileWorkspaceWidth.scroll > mobileWorkspaceWidth.view) throw new Error(`Mobile workspace overflow: ${JSON.stringify(mobileWorkspaceWidth)}`);
await mp.screenshot({ path: `${out}/11-mobile-workspace.png` });
await browser.close();
console.log('screens saved to', out);
