// Standard proof (Liquid Mercury, Camp Southern Ground, Audubon, Honeywell, Arroyo Grande, Kane County).
// Measured: plaque drawn at true size when it fits, otherwise scaled to at most 504 x 432 pt,
// centered on x = 362.96; red brackets 30.24 pt above and 34.4 pt left; right column with the
// mounting diagram then the finish and paint-fill swatches; footer rule, wordmark, disclaimer.
import { findOption, mustOption, paintHex, paintLabel } from '../../catalog.js';
import { findAsset } from '../../assets.js';
import type { ProofInput } from './index.js';
import {
  COLORS, Y, dimLabel, drawContain, embedImageFile, embedSquare, line, newProofDoc, placeTemplate, plaqueJpg, text, wordmark, wrap,
} from './common.js';

export const STANDARD_BOX = { cx: 362.96, top: 92.84, maxW: 504, maxH: 432, maxScale: 72 };

export function standardPlaqueRect(widthIn: number, heightIn: number, withNote = false) {
  const b = STANDARD_BOX;
  const s = Math.min(b.maxScale, b.maxW / widthIn, b.maxH / heightIn);
  const w = widthIn * s;
  const h = heightIn * s;
  const shift = withNote ? 28.3 : 0;
  const top = (h >= b.maxH - 0.01 ? b.top : b.top + (b.maxH - h) / 2) - shift;
  return { x: b.cx - w / 2, y: top, w, h, scale: s };
}

export async function buildStandardProof(input: ProofInput): Promise<Buffer> {
  const { spec } = input;
  const { doc, fonts } = await newProofDoc(`Proof - ${input.jobNumber}`, JSON.stringify(spec));
  const page = doc.addPage([792, 612]);
  const noteLines = input.proofNote ? input.proofNote.split('\n').filter(Boolean) : [];

  // Plaque image.
  const r = standardPlaqueRect(spec.widthIn, spec.heightIn, noteLines.length > 0);
  page.drawImage(await plaqueJpg(doc, input.plaqueImage, r.w, r.h), { x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h });

  // Dimension brackets (red), measured on Liquid Mercury.
  const topY = r.y - 30.24;
  line(page, r.x, topY, r.x + r.w, topY, 0.672);
  line(page, r.x, topY, r.x, topY + 21.9, 0.672);
  line(page, r.x + r.w, topY, r.x + r.w, topY + 21.9, 0.672);
  text(page, fonts.label, dimLabel(spec.widthIn), r.x + r.w / 2, topY - 13.87, 18.3, COLORS.ink, 'center');
  const leftX = r.x - 34.4;
  line(page, leftX, r.y, leftX, r.y + r.h, 0.75);
  line(page, leftX, r.y, leftX + 23.3, r.y, 0.75);
  line(page, leftX, r.y + r.h, leftX + 23.3, r.y + r.h, 0.75);
  text(page, fonts.label, dimLabel(spec.heightIn), leftX - 8.5, r.y + r.h / 2 + 5.37, 18.3, COLORS.ink, 'right');

  // Red note under the plaque (Honeywell): Myriad 14 pt, centered.
  noteLines.forEach((l, i) => text(page, fonts.label, l, r.x + r.w / 2, r.y + r.h + 33.4 + i * 16.8, 14, COLORS.red, 'center'));

  // Right column: mounting diagram.
  const mounting = mustOption('mountings', spec.mounting);
  let swatchTop = 340.8;
  if (spec.mounting === 'blind-studs') {
    await placeTemplate(doc, page, 'mount-blind', [686, 20, 782, 322]);
  } else {
    const file = findAsset(mounting.diagram as string | undefined) ?? findAsset(mounting.tile as string | undefined);
    if (file) drawContain(page, await embedImageFile(doc, file), 674.3, 94.2, 109.5, 171.5);
    text(page, fonts.label, mounting.label, 729.05, 282.1, 12, COLORS.ink, 'center');
    swatchTop = 313.8;
  }

  // Finish swatch + name (74 x 74), process note under it when reverse etched.
  const finish = mustOption('finishes', spec.finish);
  const process = findOption('processes', spec.process);
  const finishLines = [...wrap(fonts.label, finish.proofLabel ?? finish.label, 12, 84), ...(process?.proofFinishNote ? [process.proofFinishNote] : [])];
  page.drawImage(await embedSquare(doc, findAsset(finish.asset), finish.hex ?? '#C49A6C'), { x: 694.9, y: Y(swatchTop + 74), width: 74, height: 74 });
  finishLines.forEach((l, i) => text(page, fonts.label, l, 731.96, swatchTop + 90.38 + i * 14.4, l === process?.proofFinishNote ? 9 : 12, COLORS.ink, 'center'));

  // Paint-fill swatch (72 x 72) + "<Color>" / "Paint Fill".
  const paintTop = swatchTop + 111 + (finishLines.length - 1) * 14.4;
  const paint = mustOption('backgroundColors', spec.backgroundColor);
  const paintFile = spec.backgroundColor === 'custom' ? null : findAsset(paint.asset);
  page.drawImage(await embedSquare(doc, paintFile, paintHex(spec)), { x: 696, y: Y(paintTop + 72), width: 72, height: 72 });
  const paintLines = [...wrap(fonts.label, paintLabel(spec), 12, 84), 'Paint Fill', ...(process?.proofPaintNote ? [process.proofPaintNote] : [])];
  paintLines.forEach((l, i) => text(page, fonts.label, l, 731.96, paintTop + 88.88 + i * 14.4, l === process?.proofPaintNote ? 9 : 12, COLORS.ink, 'center'));

  // Footer: navy rule, wordmark, disclaimer (both lifted from the real proofs).
  page.drawRectangle({ x: 18, y: Y(573.7), width: 756, height: 1.2, color: COLORS.navy });
  wordmark(page, 18, 575);
  if (input.disclaimer === 'photo') await placeTemplate(doc, page, 'disclaimer-photo', [290, 583, 790, 606]);
  else await placeTemplate(doc, page, 'disclaimer-standard', [300, 576, 790, 606]);

  return Buffer.from(await doc.save());
}
