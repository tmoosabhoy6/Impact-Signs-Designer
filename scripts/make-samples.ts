// Builds every example job from references/ in its proof style and places our proof next to
// the real one, so they can be compared on GitHub:  npm run samples
// The plaque on each sample proof is the app's flat layout drawing (no OpenAI call).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { parseSpec } from '../server/parse/spec';
import { docxToText, parseWording } from '../server/parse/wording';
import { computeLayout } from '../server/layout/engine';
import { preparePhoto, renderFlatPng } from '../server/render/flat';
import { buildProof } from '../server/pdf/proofs/index';
import { buildProductionPdf } from '../server/pdf/production';
import { preflight } from '../server/pdf/preflight';
import { listExamples } from '../server/examples';
import { mustOption } from '../server/catalog';
import type { Wording } from '../shared/types';

const OUT = 'output/samples';
fs.mkdirSync(OUT, { recursive: true });

function pdfPng(pdf: string, dpi: number, pageNo = 1): Buffer | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pps-'));
  try {
    execFileSync('pdftocairo', ['-png', '-singlefile', '-r', String(dpi), '-f', String(pageNo), '-l', String(pageNo), pdf, path.join(tmp, 'p')]);
    return fs.readFileSync(path.join(tmp, 'p.png'));
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function sideBySide(ours: Buffer, theirs: Buffer | null, out: string) {
  const a = await sharp(ours).resize({ width: 880 }).png().toBuffer();
  if (!theirs) return fs.writeFileSync(out, a);
  const b = await sharp(theirs).resize({ width: 880 }).png().toBuffer();
  const ma = await sharp(a).metadata();
  const mb = await sharp(b).metadata();
  const label = (t: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="880" height="34"><rect width="880" height="34" fill="#2E3092"/><text x="12" y="23" font-family="sans-serif" font-size="17" fill="#fff">${t}</text></svg>`);
  const h = Math.max(ma.height!, mb.height!) + 34;
  await sharp({ create: { width: 1780, height: h, channels: 3, background: '#d0d0d0' } })
    .composite([
      { input: label('Plaque Proof Studio'), left: 0, top: 0 },
      { input: a, left: 0, top: 34 },
      { input: label('Real proof (reference)'), left: 900, top: 0 },
      { input: b, left: 900, top: 34 },
    ])
    .png()
    .toFile(out);
}

const index: string[] = ['# Sample outputs', '', 'Each example job from `references/`, built by the app in its proof style (left) next to the real Impact Signs proof (right). The plaque on our proofs is the code-drawn layout drawing; in the app it is the AI concept you pick.', ''];

for (const ex of listExamples()) {
  const specText = fs.readFileSync(path.join(ex.dir, ex.spec), 'utf8');
  const parse = parseSpec(specText, { hasPhoto: [ex.photo ?? []].flat().length > 0 });
  const spec = { ...parse.spec, ...(ex.specOverrides?.widthIn ? { widthIn: ex.specOverrides.widthIn } : {}), ...(ex.specOverrides?.heightIn ? { heightIn: ex.specOverrides.heightIn } : {}) };
  if (ex.specOverrides?.customPaintHex && spec.customPaint) spec.customPaint = { ...spec.customPaint, hex: ex.specOverrides.customPaintHex };
  const wf = path.join(ex.dir, ex.wording);
  let wording: Wording;
  if (wf.endsWith('.json')) {
    wording = { blocks: JSON.parse(fs.readFileSync(wf, 'utf8')).map((b: object, i: number) => ({ id: `w${i}`, ...b })), notes: [] };
  } else {
    wording = parseWording(wf.endsWith('.docx') ? await docxToText(fs.readFileSync(wf)) : fs.readFileSync(wf, 'utf8'));
  }
  const photoFiles = [ex.photo ?? []].flat().map((f) => path.join(ex.dir, f));
  const photos = await Promise.all(photoFiles.map((f) => sharp(f).png().toBuffer()));
  const metas = await Promise.all(photos.map((b) => sharp(b).metadata()));
  const layout = computeLayout({ spec, wording, photos: metas.map((m, i) => ({ id: `p${i}`, aspect: m.width! / m.height! })), imageAfterBlock: ex.imageAfterBlock ?? null }, 'classic');
  const k = Math.min(160, 2400 / Math.max(spec.widthIn, spec.heightIn));
  const photoPngs = await Promise.all(photos.map((b) => preparePhoto(b, spec.imageOption, mustOption('finishes', spec.finish).hex ?? '#C49A6C')));
  const plaque = await renderFlatPng(layout, spec, { pxPerIn: k, widthPx: Math.round(spec.widthIn * k), heightPx: Math.round(spec.heightIn * k), photoPngs });
  const prod = await buildProductionPdf({ jobNumber: ex.jobNumber, name: ex.name, spec, layout });
  const style = ex.proofStyle ?? 'standard';
  const proof = await buildProof(style, {
    jobNumber: ex.jobNumber,
    version: 1,
    spec,
    wording,
    layout,
    plaqueImage: plaque,
    proofNote: ex.proofNote ?? null,
    fontStated: !parse.assumed.includes('font'),
    disclaimer: ex.disclaimer ?? 'standard',
    productionPdf: prod.pdf,
  });
  const base = `${ex.jobNumber}-${style}`;
  fs.writeFileSync(`${OUT}/${base}-proof.pdf`, proof);
  fs.writeFileSync(`${OUT}/${prod.fileName}`, prod.pdf);
  const refPdf = fs.readdirSync(ex.dir).find((f) => /^proof\.pdf$|liquid mercury\.pdf$/i.test(f));
  const ours = pdfPng(`${OUT}/${base}-proof.pdf`, 110);
  const theirs = refPdf ? pdfPng(path.join(ex.dir, refPdf), 110) : null;
  if (ours) await sideBySide(ours, theirs, `${OUT}/${base}-compare.png`);
  if (style === 'etched') {
    const p2 = pdfPng(`${OUT}/${base}-proof.pdf`, 110, 2);
    const r2 = refPdf ? pdfPng(path.join(ex.dir, refPdf), 110, 2) : null;
    if (p2) await sideBySide(p2, r2, `${OUT}/${base}-compare-page2.png`);
  }
  const checks = await preflight(prod.pdf, layout, { fontLicensed: false });
  const failed = checks.filter((c) => !c.ok && !c.warnOnly).map((c) => c.label);
  index.push(`## ${ex.jobNumber} · ${ex.name}`, '', `${ex.description}`, '', `![${ex.name}](${base}-compare.png)`, '', `Proof: [${base}-proof.pdf](${base}-proof.pdf) · Vector production file: [${prod.fileName}](${encodeURI(prod.fileName)}) · Preflight: ${failed.length ? 'FAILED ' + failed.join(', ') : 'passed'}`, '');
  console.log(`${base}: ${spec.widthIn}x${spec.heightIn} ${style}${failed.length ? ' PREFLIGHT FAILED ' + failed.join(',') : ''}  ${layout.warnings.join(' | ')}`);
}
fs.writeFileSync(`${OUT}/README.md`, index.join('\n'));
console.log(`Samples written to ${OUT}/`);
