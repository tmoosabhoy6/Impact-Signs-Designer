// Focused offline browser check: two layouts, 1.5K downloads, and edits of the selected version.
// MOCK_AI=1 server required. BASE=http://localhost:8091 PW=local-check node scripts/check-concepts.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import sharp from 'sharp';

const base = process.env.BASE || 'http://localhost:8080';
const out = process.env.OUT || '/tmp/plaque-two-concept-check/screens';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
try {
  const login = await ctx.request.post(`${base}/api/login`, { data: { name: 'Concept check', password: process.env.PW || 'local-check' } });
  if (!login.ok()) throw new Error('Local sign-in failed.');
  const mode = await (await ctx.request.get(`${base}/api/me`)).json();
  if (!mode.mock) throw new Error('This check requires MOCK_AI=1; no paid calls are made.');
  const { examples } = await (await ctx.request.get(`${base}/api/examples`)).json();
  const orientations = new Set();
  for (const [id, orientation] of [['32241-edwin-feulner', 'portrait'], ['32241-edwin-feulner', 'landscape']]) {
    if (!examples.some((e) => e.id === id)) throw new Error(`Missing example ${id}`);
    let { project } = await (await ctx.request.post(`${base}/api/examples/${id}`, { data: {} })).json();
    if (orientation === 'landscape') {
      ({ project } = await (await ctx.request.patch(`${base}/api/projects/${project.id}`, { data: { spec: { widthIn: 18, heightIn: 12 } } })).json());
    }
    orientations.add(project.spec.widthIn > project.spec.heightIn ? 'landscape' : 'portrait');
    await page.goto(`${base}/jobs/${project.id}`);
    await page.getByRole('button', { name: 'Generate 2 concepts', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use this one')).length === 2);
    await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
    const headings = await page.locator('.concept-column h3').allTextContents();
    if (headings.join('|') !== 'Classic|Statement') throw new Error(`Unexpected layouts: ${headings}`);
    const payload = await (await ctx.request.get(`${base}/api/projects/${project.id}`)).json();
    if (payload.concepts.length !== 2) throw new Error('Generation did not produce exactly two records.');
    for (const concept of payload.concepts) {
      const response = await ctx.request.get(`${base}/api/concepts/${concept.id}/image.png`);
      const metadata = await sharp(await response.body()).metadata();
      if (Math.max(metadata.width, metadata.height) !== 1536 || concept.quality !== 'max') throw new Error('Unexpected image resolution or quality.');
    }
    await page.screenshot({ path: `${out}/${id}-${orientation}-concepts.png` });
    const source = payload.concepts.find((c) => c.preset === 'statement');
    const instruction = 'space out the wording just slightly so there is more room on the plaque';
    const column = page.locator('.concept-column').filter({ has: page.getByRole('heading', { name: 'Statement', exact: true }) });
    await column.getByLabel('Describe a change for this image').fill(instruction);
    const editing = page.waitForRequest((r) => r.url().endsWith(`/concepts/${source.id}/fix`) && r.method() === 'POST');
    await column.getByRole('button', { name: 'Apply', exact: true }).click();
    if ((await editing).postDataJSON().instruction !== instruction) throw new Error('The browser changed the edit instruction.');
    await column.getByRole('status').filter({ hasText: 'Interpreted as:' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
    const edited = await (await ctx.request.get(`${base}/api/projects/${project.id}`)).json();
    const version = edited.concepts.at(-1);
    if (version.status !== 'done' || version.parentId !== source.id || version.instruction !== instruction) throw new Error('Fix did not create a finished child of the selected image.');
    if (JSON.stringify(edited.project.wording) !== JSON.stringify(project.wording)) throw new Error('Spacing changed the customer wording.');
    if (JSON.stringify(version.plan.layoutPatch) !== JSON.stringify({ spacing: 1.12 })) throw new Error('Spacing changed more than the gaps.');
    const response = await ctx.request.get(`${base}/api/concepts/${version.id}/image.png`);
    const metadata = await sharp(await response.body()).metadata();
    if (Math.max(metadata.width, metadata.height) !== 1536) throw new Error('Edited image is not 1.5K.');
    await column.screenshot({ path: `${out}/${id}-${orientation}-spacing-edit.png` });
    console.log(`${id} ${orientation}: Classic + Statement; Max 1536 px; selected-image spacing edit passed.`);
  }
  if (orientations.size !== 2) throw new Error('The check needs both portrait and landscape examples.');
  console.log(`Screenshots: ${out}`);
} finally { await browser.close(); }
