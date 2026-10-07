// Explicit live verification; never run from the offline test suite.
// RUN_LIVE_IMAGE_CHECK=1 MOCK_AI=0 DATA_DIR=/tmp/plaque-live-check npx tsx scripts/verify-image-features.ts
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import fontkit from '@pdf-lib/fontkit';
import { config } from '../server/config.js';
import { blankProject, newId, saveProject } from '../server/db.js';
import { parseSpec } from '../server/parse/spec.js';
import { createExampleJob } from '../server/examples.js';
import { storeUpload } from '../server/uploads.js';
import { resolveFont, textPath } from '../server/text/fonts.js';
import { applyPlan, planInstruction } from '../server/ai/instruct.js';
import { conceptFile, newConceptRecord, projectForConcept, runConcept } from '../server/ai/pipeline.js';
import type { ConceptRecord, Project } from '../shared/types.js';

if (process.env.RUN_LIVE_IMAGE_CHECK !== '1' || config.mockAI || !config.openaiKey) {
  throw new Error('This check needs RUN_LIVE_IMAGE_CHECK=1, MOCK_AI=0 and OPENAI_API_KEY in the environment. It makes up to six paid images.');
}
const out = path.resolve(process.env.OUT || `output/live/image-features-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });
const results: { label: string; concept: ConceptRecord }[] = [];
async function render(p: Project, c: ConceptRecord, label: string) {
  console.log(`Starting ${label}`);
  const done = await runConcept(p, c, { onPartial() {}, onUpdate(v) {
    if (v.status === 'done' || v.status === 'error') console.log(`${label}: ${v.status}; ${Math.round((v.durationMs ?? 0) / 1000)}s; ${v.error ?? v.designReview?.message ?? ''}`);
  } });
  results.push({ label, concept: done });
  if (done.hasImage) fs.copyFileSync(conceptFile(done, 'image.png'), path.join(out, `${label}.png`));
  if (fs.existsSync(conceptFile(done, 'layout.png'))) fs.copyFileSync(conceptFile(done, 'layout.png'), path.join(out, `${label}-layout.png`));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  return done;
}
let exact = blankProject({ jobNumber: 'EXACT-CHECK', name: 'Exact design live check', createdBy: 'Verification' });
exact.spec = parseSpec('12"w x 8"h cast bronze plaque, satin finish, dark oxide background, single line border, blind mounting, no image').spec;
const plain = resolveFont('times-new-roman').font;
const scriptFile = '/System/Library/Fonts/Supplemental/Apple Chancery.ttf';
let headline = `<path d="${textPath(resolveFont('times-new-roman', { italic: true }).font, 'The Willow Garden', 235, 210, 86)}" fill="#231f20"/>`;
if (fs.existsSync(scriptFile)) {
  const face = fontkit.create(fs.readFileSync(scriptFile));
  const run = face.layout('The Willow Garden');
  let x = 0;
  const glyphs = run.glyphs.map((g, i) => {
    const p = run.positions[i];
    const svg = `<path transform="translate(${x + p.xOffset},${p.yOffset})" d="${g.path.toSVG()}"/>`;
    x += p.xAdvance;
    return svg;
  });
  const scale = 86 / face.unitsPerEm;
  headline = `<g transform="translate(235,210) scale(${scale},${-scale})" fill="#231f20">${glyphs.join('')}</g>`;
}
const source = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/>
${headline}
<path d="${textPath(plain, 'Est. 1987', 445, 540, 45)}" fill="#231f20"/>
<path d="M270 365 C430 300 680 420 930 350 M280 380 C480 330 740 425 920 368" fill="none" stroke="#231f20" stroke-width="5"/>
<g fill="none" stroke="#231f20" stroke-width="7"><path d="M145 650 Q120 445 175 280 M145 535 Q55 460 70 400 Q150 425 145 535 M149 465 Q225 385 225 345 Q145 365 149 465"/><circle cx="175" cy="265" r="19"/><path d="M175 245 C105 180 95 285 155 275 M195 265 C265 220 225 155 183 246 M174 284 C195 355 252 287 194 270"/></g>
<path d="M1000 635 C925 565 975 530 1000 565 C1025 530 1075 565 1000 635Z" fill="#ed1c24"/>
<path d="M340 630 Q375 680 415 630 T495 630" fill="none" stroke="#231f20" stroke-width="4"/></svg>`);
fs.writeFileSync(path.join(out, 'exact-source.svg'), source);
await sharp(source).png().toFile(path.join(out, 'exact-source.png'));
exact = await storeUpload(exact, 'exact-design', 'approved-art.svg', source);
saveProject(exact);
const batch = newId('b');
const exactRecords = await Promise.all(['classic', 'statement'].map((preset) => render(exact, newConceptRecord(exact, { preset: preset as 'classic' | 'statement', kind: 'concept', batchId: batch }), `exact-${preset}`)));

if (process.env.LIVE_CHECK_SCOPE !== 'exact') {
  let regular = await createExampleJob('32241-edwin-feulner', 'Live verification');
  const normal = await render(regular, newConceptRecord(regular, { preset: 'statement', kind: 'concept', batchId: newId('b') }), 'regular');
  const sketch = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="white"/><path d="M25 30 L570 35 L580 860 L20 870Z M65 80 L265 90 L270 390 L60 380Z M305 110 L525 110 M305 175 L530 180 M305 240 L515 245 M65 470 L525 480 M65 555 L535 545 M65 630 L530 630 M65 720 L525 715" fill="none" stroke="#555" stroke-width="5"/></svg>');
  regular = await storeUpload(regular, 'sketch', 'rough-layout.svg', sketch);
  saveProject(regular);
  await render(regular, newConceptRecord(regular, { preset: 'classic', kind: 'concept', batchId: newId('b') }), 'sketch');

  async function edit(p: Project, parent: ConceptRecord, instruction: string, label: string) {
    if (parent.status !== 'done') { console.log(`${label} skipped: original image did not finish.`); return; }
    const sourceProject = projectForConcept(p, parent);
    const plan = await planInstruction(sourceProject, parent, instruction);
    applyPlan(sourceProject, plan, parent.preset);
    await render(sourceProject, newConceptRecord(sourceProject, { preset: parent.preset, kind: 'fix', batchId: parent.batchId, parentId: parent.id, model: parent.model, instruction, note: 'restated' in plan ? plan.restated : instruction, plan }), label);
  }
  await Promise.all([
    edit(exact, exactRecords[0], 'Change only the small red heart at the bottom right to blue. Keep its shape, size and position, and preserve every other detail exactly.', 'small-edit'),
    edit(regular, normal, 'Move the portrait down and to the left. Put the main headline at the upper right and the dedication text below it on the right. Keep all wording character for character, retain the original fonts, photo likeness, border, finish and lighting. Only rearrange those requested groups; do not redesign the artwork.', 'large-edit'),
  ]);
}
console.log(`Live artifacts: ${out}`);
if (results.some(({ concept }) => concept.status !== 'done')) process.exitCode = 1;
