// Focused offline UI check of design evidence, skipped review and visible issue notes.
// The failing review response is a browser fixture; server gating is covered by route tests.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.env.BASE || 'http://localhost:8080';
const out = process.env.OUT || '/tmp/plaque-design-check';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
try {
  const login = await ctx.request.post(`${base}/api/login`, { data: { name: 'Design check', password: process.env.PW || 'local-check' } });
  if (!login.ok()) throw new Error('Local sign-in failed.');
  const mode = await (await ctx.request.get(`${base}/api/me`)).json();
  if (!mode.mock) throw new Error('This check requires MOCK_AI=1; no paid calls are made.');
  const created = await ctx.request.post(`${base}/api/examples/32241-edwin-feulner`, { data: {} });
  const { project } = await created.json();
  const generated = await ctx.request.post(`${base}/api/projects/${project.id}/generate`, { data: {}, timeout: 120_000 });
  await generated.body();
  const payload = await (await ctx.request.get(`${base}/api/projects/${project.id}`)).json();
  if (payload.concepts.length !== 2) throw new Error('Expected two concepts.');
  for (const concept of payload.concepts) {
    if (concept.status !== 'done' || concept.designContext?.examples.length !== 3 || concept.designReview?.checked !== false) throw new Error('Evidence or skipped review is missing.');
  }
  if (JSON.stringify(payload.project.wording) !== JSON.stringify(project.wording)) throw new Error('Guidance changed customer wording.');
  await page.goto(`${base}/jobs/${project.id}`);
  const classic = page.locator('.concept-column').filter({ has: page.getByRole('heading', { name: 'Classic', exact: true }) });
  await classic.locator('summary').click();
  for (const e of payload.concepts.find((c) => c.preset === 'classic').designContext.examples) await classic.getByText(e.label, { exact: true }).waitFor();
  await classic.getByText('Design review skipped (demo mode). Inspect the image yourself.', { exact: true }).waitFor();
  await classic.screenshot({ path: `${out}/evidence-and-demo-review.png`, animations: 'disabled' });

  const current = payload.concepts.find((c) => c.preset === 'classic');
  await ctx.request.post(`${base}/api/projects/${project.id}/select`, { data: { conceptId: current.id } });
  const issue = 'The bottom dedication is cut off.';
  await page.route(`${base}/api/projects/${project.id}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const c = data.concepts.find((c) => c.id === current.id);
    c.designReview = { ok: false, checked: true, message: 'Design review found issues. Check the notes before making a proof.', checks: [{ criterion: 'layout', ok: false, detail: issue }] };
    await route.fulfill({ response, json: data });
  });
  const warning = 'The design review needs attention before this proof is made. Inspect the image and the notes below.';
  await page.route(`${base}/api/projects/${project.id}/proof`, (route) => route.fulfill({ status: 409, json: { error: warning, differences: [], issues: [issue] } }));
  await page.reload();
  await classic.getByText(issue, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create proof PDF', exact: true }).click();
  await page.getByText(warning, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'I checked it: create proof anyway', exact: true }).waitFor();
  await page.screenshot({ path: `${out}/design-issues-before-proof.png`, fullPage: true, animations: 'disabled' });
  console.log(`Design evidence, honest skipped review, failed-review notes and proof warning passed. Screenshots: ${out}`);
} finally { await browser.close(); }
