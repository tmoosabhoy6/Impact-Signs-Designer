// Order / version proof with outline art (Structure of Merit, 32249).
// Page 1, measured: red "ORDER #n - VERSION v" Arial Narrow 19 pt at (16.4, 21.5); plaque in a
// 482 x 338 pt box centered at (346.2, 290.1); red dimension lines (top 34.4 pt above the plaque,
// left 33 pt beside it) with Arial Narrow 22.4 pt labels like 7"; right column: side-view blind
// mount, then the finish swatch with its process caption and the paint swatch; footer rule,
// wordmark and the red "****Colors & effects for illustrative purposes only****".
// Page 2: "OUTLINE ART FILE FOR PRODUCTION USE ONLY" with the one-ink production art at true scale.
import { PDFDocument } from 'pdf-lib';
import { findOption, mustOption, paintHex, paintLabel } from '../../catalog.js';
import { findAsset } from '../../assets.js';
import type { ProofInput } from './index.js';
import {
  COLORS, PAGE, Y, drawContain, embedImageFile, embedSquare, line, newProofDoc, placeTemplate, plainInchLabel, plaqueJpg, text, wordmark, wrap,
} from './common.js';

/** Measured: the 7x5 plaque is drawn at true size, 505 x 361 pt at (94, 110). */
export function etchedPlaqueRect(widthIn: number, heightIn: number) {
  const s = Math.min(72, 505 / widthIn, 361 / heightIn);
  const w = widthIn * s;
  const h = heightIn * s;
  return { x: 346.5 - w / 2, y: 290.5 - h / 2, w, h, scale: s };
}

export async function buildEtchedProof(input: ProofInput): Promise<Buffer> {
  const { spec } = input;
  const { doc, fonts } = await newProofDoc(`Proof-${input.jobNumber}`, JSON.stringify(spec));
  const page = doc.addPage([PAGE.w, PAGE.h]);

  text(page, fonts.narrow, `ORDER #${input.jobNumber} - VERSION ${input.version}`, 16.4, 21.5, 19, COLORS.red);

  const r = etchedPlaqueRect(spec.widthIn, spec.heightIn);
  page.drawImage(await plaqueJpg(doc, input.plaqueImage, r.w, r.h), { x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h });

  // Red dimensions.
  const ty = r.y - 23.3;
  line(page, r.x, ty, r.x + r.w, ty, 1.0);
  line(page, r.x, ty, r.x, ty + 15, 1.0);
  line(page, r.x + r.w, ty, r.x + r.w, ty + 15, 1.0);
  text(page, fonts.narrow, plainInchLabel(spec.widthIn), r.x + r.w / 2, ty - 7.7, 22.4, COLORS.red, 'center');
  const lx = r.x - 22.5;
  line(page, lx, r.y, lx, r.y + r.h, 1.2);
  line(page, lx, r.y, lx + 15, r.y, 1.2);
  line(page, lx, r.y + r.h, lx + 15, r.y + r.h, 1.2);
  text(page, fonts.narrow, plainInchLabel(spec.heightIn), lx - 8.7, r.y + r.h / 2 + 11.5, 22.4, COLORS.red, 'right');

  // Right column: mounting.
  const mounting = mustOption('mountings', spec.mounting);
  if (spec.mounting === 'blind-studs') {
    await placeTemplate(doc, page, 'mount-blind-sideview', [684, 10, 784, 316]);
  } else {
    const file = findAsset(mounting.diagram as string | undefined) ?? findAsset(mounting.tile as string | undefined);
    if (file) drawContain(page, await embedImageFile(doc, file), 670, 30, 110, 250);
    text(page, fonts.label, 'Side View', 723.35, 309.9, 18.3, COLORS.ink, 'center');
  }

  // Finish swatch + caption with the process line.
  const finish = mustOption('finishes', spec.finish);
  const process = findOption('processes', spec.process);
  page.drawImage(await embedSquare(doc, findAsset(finish.asset), finish.hex ?? '#C49A6C'), { x: 677.8, y: Y(341.7 + 74), width: 74, height: 74 });
  const fl = [finish.proofLabel ?? finish.label, ...(process?.proofFinishNote ? [process.proofFinishNote] : [])];
  fl.forEach((l, i) => text(page, fonts.narrow, l, 714.8, 428.1 + i * 14.4, 12, COLORS.ink, 'center'));
  const paint = mustOption('backgroundColors', spec.backgroundColor);
  const paintFile = spec.backgroundColor === 'custom' ? null : findAsset(paint.asset);
  page.drawImage(await embedSquare(doc, paintFile, paintHex(spec)), { x: 678.8, y: Y(457.2 + 72), width: 72, height: 72 });
  const pl = [...wrap(fonts.narrow, `${paintLabel(spec)} Paint Fill`, 12, 140), ...(process?.proofPaintNote ? [process.proofPaintNote] : [])];
  pl.forEach((l, i) => text(page, fonts.narrow, l, 714.8, 545.7 + i * 14.4, 12, COLORS.ink, 'center'));

  // Footer.
  page.drawRectangle({ x: 18, y: Y(573.7), width: 756, height: 1.2, color: COLORS.navy });
  wordmark(page, 18, 575);
  await placeTemplate(doc, page, 'etched-footer-note', [440, 578, 750, 606]);

  // Page 2: outline art for production, at true scale when it fits.
  if (input.productionPdf) {
    const p2 = doc.addPage([PAGE.w, PAGE.h]);
    text(p2, fonts.narrow, 'OUTLINE ART FILE FOR PRODUCTION USE ONLY', 17.2, 29.2, 19, COLORS.red);
    const prod = await PDFDocument.load(input.productionPdf);
    const [art] = await doc.embedPdf(prod, [0]);
    const s = Math.min(1, 700 / art.width, 470 / art.height);
    const w = art.width * s;
    const h = art.height * s;
    p2.drawPage(art, { x: 377.3 - w / 2, y: Y(271.6 + h / 2), width: w, height: h });
    if (s < 0.999) text(p2, fonts.narrow, `Shown at ${Math.round(s * 100)}% of actual size (${+spec.widthIn.toFixed(3)}" x ${+spec.heightIn.toFixed(3)}")`, 377.3, 271.6 + h / 2 + 24, 12, COLORS.red, 'center');
  }
  return Buffer.from(await doc.save());
}
