// Focused browser check. Requires the mock server; never makes paid requests.
// BASE=http://localhost:8096 PW=local-check node scripts/check-exact-design.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.BASE || 'http://localhost:8096';
const out = process.env.OUT || '/tmp/plaque-exact-design-ui';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  const login = await context.request.post(`${base}/api/login`, { data: { name: 'Exact design check', password: process.env.PW || 'local-check' } });
  if (!login.ok()) throw new Error('Local sign-in failed.');
  const mode = await (await context.request.get(`${base}/api/me`)).json();
  if (!mode.mock) throw new Error('This check requires MOCK_AI=1.');
  const result = await context.request.post(`${base}/api/projects`, { data: { jobNumber: 'EXACT-UI', name: 'Exact design browser check' } });
  const { project } = await result.json();
  await context.request.post(`${base}/api/projects/${project.id}/spec`, { data: { specText: '12"w x 8"h bronze plaque, satin finish, dark oxide background, single line border, blind mounting, no image' } });
  await page.goto(`${base}/jobs/${project.id}`);
  const art = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="white"/><path d="M100 180 Q200 20 320 180 T570 180 M100 450 Q300 300 530 435" stroke="#231f20" stroke-width="10" fill="none"/><circle cx="720" cy="380" r="45" fill="#ed1c24"/></svg>');
  await page.getByLabel('Choose exact designs', { exact: true }).setInputFiles({ name: 'approved-design.svg', mimeType: 'image/svg+xml', buffer: art });
  await page.getByText('Exact design takes priority over sketches', { exact: false }).waitFor();
  if (!(await page.getByRole('button', { name: 'Generate 2 concepts', exact: true }).isEnabled())) throw new Error('Exact design did not enable generation without wording/photos.');
  await page.getByText('Exact design', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/upload.png` });
  await page.getByRole('button', { name: 'Generate 2 concepts', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Use this one')).length === 2);
  await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
  await page.getByRole('button', { name: 'Use this one', exact: true }).first().click();
  await page.getByRole('button', { name: 'Create proof PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Create vector PDF', exact: true }).waitFor();
  if (await page.getByRole('button', { name: 'Create vector PDF', exact: true }).isEnabled()) throw new Error('Exact artwork should not produce an unrelated synthetic vector layout.');
  const column = page.locator('.concept-column').first();
  await column.getByLabel('Describe a change for this image').fill('Change only the red circle to blue');
  await column.getByRole('button', { name: 'Apply', exact: true }).click();
  await column.getByRole('status').filter({ hasText: 'Sent to the image model as written' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('article button[title="Generate this layout again"]')?.disabled);
  const payload = await (await context.request.get(`${base}/api/projects/${project.id}`)).json();
  if (payload.concepts.length !== 3 || payload.concepts.at(-1).status !== 'done' || payload.concepts.at(-1).plan.kind !== 'visual') throw new Error('Exact design edit did not finish as a child image edit.');
  if (payload.outputs.filter((o) => o.kind === 'proof').length !== 1) throw new Error('Customer proof was not created.');
  const proof = payload.outputs.find((o) => o.kind === 'proof');
  const preview = await context.request.get(`${base}/api/outputs/${proof.id}/preview.png`);
  if (!preview.ok()) throw new Error('The proof preview did not load.');
  fs.writeFileSync(`${out}/proof.png`, await preview.body());
  await page.screenshot({ path: `${out}/concepts-proof-edit.png` });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Exact design UI passed: upload, generation without wording, proof, selected-image edit, production guard. Screenshots: ${out}`);
} finally { await browser.close(); }
