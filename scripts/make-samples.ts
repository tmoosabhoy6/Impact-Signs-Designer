// Renders sample outputs for the Heritage Foundation job into output/samples/
// so they can be opened directly on GitHub:  npm run samples
// The plaque image on the sample proof is the flat layout drawing (no OpenAI call).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { parseSpec } from '../server/parse/spec';
import { docxToText, parseWording } from '../server/parse/wording';
import { computeLayout, PRESETS } from '../server/layout/engine';
import { preparePhoto, renderFlatPng } from '../server/render/flat';
import { buildProofPdf } from '../server/pdf/proof';
import { buildProductionPdf } from '../server/pdf/production';
import { preflight } from '../server/pdf/preflight';

const OUT = 'output/samples';
const REF = 'references/32241-edwin-feulner';
fs.mkdirSync(OUT, { recursive: true });

const spec = parseSpec(fs.readFileSync(`${REF}/spec.txt`, 'utf8')).spec;
const wording = parseWording(await docxToText(fs.readFileSync(`${REF}/Edwin-J.docx`)));
const photo = await sharp(`${REF}/Edwin_J_Feulner_Jr0.tiff`).png().toBuffer();
const toned = await preparePhoto(photo, spec.imageOption, '#C49A6C');

const png = (pdf: string, out: string, dpi: number) => {
  try {
    execFileSync('pdftocairo', ['-png', '-singlefile', '-r', String(dpi), pdf, out]);
  } catch {
    console.warn('pdftocairo not installed: skipped', out);
  }
};

for (const p of PRESETS) {
  const layout = computeLayout({ spec, wording, photoAspect: 402 / 450 }, p.id);
  const flat = await renderFlatPng(layout, spec, { pxPerIn: 64, widthPx: 768, heightPx: 1152, photoPng: toned });
  fs.writeFileSync(`${OUT}/layout-${p.id}.png`, flat);
}

const layout = computeLayout({ spec, wording, photoAspect: 402 / 450 }, 'classic');
const plaque = await renderFlatPng(layout, spec, { pxPerIn: 120, widthPx: 1440, heightPx: 2160, photoPng: toned });
fs.writeFileSync(`${OUT}/proof-32241-sample.pdf`, await buildProofPdf({ jobNumber: '32241', spec, plaqueImage: plaque }));
png(`${OUT}/proof-32241-sample.pdf`, `${OUT}/proof-32241-sample`, 110);

const prod = await buildProductionPdf({ jobNumber: '32241', name: 'Heritage Foundation', spec, layout });
fs.writeFileSync(`${OUT}/${prod.fileName}`, prod.pdf);
png(`${OUT}/${prod.fileName}`, `${OUT}/production-32241-sample`, 40);
const checks = await preflight(prod.pdf, layout, { fontLicensed: false });
fs.writeFileSync(`${OUT}/production-32241-preflight.json`, JSON.stringify(checks, null, 2));
console.log(`Samples written to ${OUT}/`);
