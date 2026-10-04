// Customer proof: the locked Impact Signs proof sheet (measured from Liquid_Mercury.pdf).
//
// Static parts (mounting diagram, footer rule, impactsigns.com wordmark, red disclaimer)
// are copied as untouched vector art from server/templates/proof-static.pdf, which
// scripts/build_proof_template.py cuts from the real proof. The job-specific parts are drawn
// on top: the selected plaque image, red dimension brackets, the finish icon and the
// paint-fill icon from the asset library.
//
// Coordinates below are written top-down (like the measurements) and flipped for PDF.
import fs from 'node:fs';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import { fromRoot } from '../config.js';
import { mustOption } from '../catalog.js';
import { findAsset, brandLogoFile } from '../assets.js';
import { proofLabelFontFile } from '../text/fonts.js';
import type { PlaqueSpec } from '../../shared/types.js';

export const PAGE = { w: 792, h: 612 };
/** Plaque area on the reference: 12x18 drawn at 24 pt/in with top-left (218.96, 92.84). */
export const PLAQUE_BOX = { cx: 362.96, top: 92.84, maxW: 440, maxH: 432, maxScale: 24 };
const RED = rgb(0xec / 255, 0x21 / 255, 0x28 / 255);
const INK = rgb(0x23 / 255, 0x1f / 255, 0x20 / 255);

export function plaqueRect(widthIn: number, heightIn: number) {
  const s = Math.min(PLAQUE_BOX.maxScale, PLAQUE_BOX.maxW / widthIn, PLAQUE_BOX.maxH / heightIn);
  const w = widthIn * s;
  const h = heightIn * s;
  const top = h >= PLAQUE_BOX.maxH - 0.01 ? PLAQUE_BOX.top : PLAQUE_BOX.top + (PLAQUE_BOX.maxH - h) / 2;
  return { x: PLAQUE_BOX.cx - w / 2, y: top, w, h, scale: s };
}

/** 12 -> 12’’ ; 12.5 -> 12½’’ ; 12.3 -> 12.3’’ (two right single quotes, as on the real proofs). */
export function dimLabel(v: number): string {
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const map: [number, string][] = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [0.125, '⅛'], [0.375, '⅜'], [0.625, '⅝'], [0.875, '⅞']];
  const hit = map.find(([f]) => Math.abs(f - frac) < 1e-6);
  const num = frac < 1e-6 ? String(whole) : hit ? `${whole || ''}${hit[1]}` : String(+v.toFixed(2));
  return `${num}’’`;
}

// Top-down helpers
const Y = (y: number) => PAGE.h - y;
function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness: number) {
  page.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness, color: RED });
}
function centeredText(page: PDFPage, font: PDFFont, text: string, cx: number, baseline: number, size: number) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: cx - w / 2, y: Y(baseline), size, font, color: INK });
}

async function iconPng(file: string | null, fallbackHex: string): Promise<Buffer> {
  if (file) return sharp(file).resize(300, 300, { fit: 'cover' }).flatten({ background: '#ffffff' }).png().toBuffer();
  return sharp({ create: { width: 64, height: 64, channels: 3, background: fallbackHex } }).png().toBuffer();
}

export interface ProofInput {
  jobNumber: string;
  spec: PlaqueSpec;
  plaqueImage: Buffer;
}

export async function buildProofPdf({ jobNumber, spec, plaqueImage }: ProofInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Proof - ${jobNumber}`);
  doc.setCreator('Plaque Proof Studio - Impact Signs');
  doc.setProducer('Plaque Proof Studio');
  doc.setSubject(JSON.stringify(spec));
  const page = doc.addPage([PAGE.w, PAGE.h]);

  // 1. Static vector template (mounting diagram, footer, disclaimer).
  const template = await PDFDocument.load(fs.readFileSync(fromRoot('server/templates/proof-static.pdf')));
  const [embedded] = await doc.embedPdf(template, [0]);
  page.drawPage(embedded, { x: 0, y: 0, width: PAGE.w, height: PAGE.h });

  // Optional: a logo file in brand-assets/ replaces the template's wordmark.
  const logoFile = brandLogoFile();
  if (logoFile) {
    const png = await sharp(logoFile, { density: 600 }).resize({ height: 200 }).png().toBuffer();
    const img = await doc.embedPng(png);
    const h = 24.4;
    const w = (img.width / img.height) * h;
    page.drawRectangle({ x: 19, y: Y(604), width: 168, height: 29, color: rgb(1, 1, 1) });
    page.drawImage(img, { x: 20.5, y: Y(577.9 + h), width: w, height: h });
  }

  const fontFile = proofLabelFontFile();
  const font = await doc.embedFont(fs.readFileSync(fontFile.file), { subset: true });

  // 2. The plaque image, sized to the plaque's exact proportions.
  const r = plaqueRect(spec.widthIn, spec.heightIn);
  const jpg = await sharp(plaqueImage).resize(Math.round(r.w * 4), Math.round(r.h * 4), { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
  const img = await doc.embedJpg(jpg);
  page.drawImage(img, { x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h });

  // 3. Dimension brackets (red), as on the reference: top 30.24 pt above, left 34.4 pt beside.
  const topY = r.y - 30.24;
  line(page, r.x, topY, r.x + r.w, topY, 0.672);
  line(page, r.x, topY, r.x, topY + 21.9, 0.672);
  line(page, r.x + r.w, topY, r.x + r.w, topY + 21.9, 0.672);
  centeredText(page, font, dimLabel(spec.widthIn), r.x + r.w / 2, topY - 13.87, 18.3);

  const leftX = r.x - 34.4;
  line(page, leftX, r.y, leftX, r.y + r.h, 0.75);
  line(page, leftX, r.y, leftX + 23.3, r.y, 0.75);
  line(page, leftX, r.y + r.h, leftX + 23.3, r.y + r.h, 0.75);
  const hl = dimLabel(spec.heightIn);
  const hw = font.widthOfTextAtSize(hl, 18.3);
  page.drawText(hl, { x: leftX - 8.5 - hw, y: Y(r.y + r.h / 2 + 5.37), size: 18.3, font, color: INK });

  // 4. Finish icon + name (74x74 at 694.9, 340.8).
  const finish = mustOption('finishes', spec.finish);
  const finishImg = await doc.embedPng(await iconPng(findAsset(finish.asset), finish.hex ?? '#C49A6C'));
  page.drawImage(finishImg, { x: 694.9, y: Y(340.8 + 74), width: 74, height: 74 });
  centeredText(page, font, finish.proofLabel ?? finish.label, 731.96, 431.18, 12);

  // 5. Paint-fill icon + "<Color> / Paint Fill" (72x72 at 696, 451.8).
  const paint = mustOption('backgroundColors', spec.backgroundColor);
  const paintImg = await doc.embedPng(await iconPng(findAsset(paint.asset), paint.hex ?? '#231F20'));
  page.drawImage(paintImg, { x: 696, y: Y(451.8 + 72), width: 72, height: 72 });
  centeredText(page, font, paint.label, 731.96, 540.68, 12);
  centeredText(page, font, 'Paint Fill', 731.96, 555.08, 12);

  return Buffer.from(await doc.save());
}
