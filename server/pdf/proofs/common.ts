// Shared drawing helpers for the three proof styles. Coordinates are written top-down
// (as measured on the real proofs, origin top-left) and flipped for PDF here.
import fs from 'node:fs';
import {
  PDFDocument, PDFOperator, PDFOperatorNames, rgb, pushGraphicsState, popGraphicsState, setFillingColor,
  moveTo, lineTo, appendBezierCurve, closePath, type PDFFont, type PDFPage, type RGB,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import { fromRoot } from '../../config.js';
import { standInFile, proofLabelFontFile, helveticaFile } from '../../text/fonts.js';

export const PAGE = { w: 792, h: 612 };
export const Y = (y: number) => PAGE.h - y;

export const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
export const COLORS = {
  ink: hex('#231F20'),
  dimRed: hex('#EC2128'),
  red: hex('#ED1C24'),
  navy: hex('#2E3092'),
  blue: hex('#1A6EA6'),
  grey: hex('#5D6061'),
  white: rgb(1, 1, 1),
  ground: hex('#806A51'),
  grass: hex('#00A650'),
};

export interface Fonts {
  label: PDFFont; // Myriad Pro (stand-in Source Sans 3)
  labelBold: PDFFont;
  helv: PDFFont; // Helvetica (stand-in Arimo)
  helvBold: PDFFont;
  narrow: PDFFont; // Arial Narrow (stand-in Archivo Narrow)
}

function narrowFile(): string {
  const lic = fromRoot('brand-assets/fonts/ArialNarrow.ttf');
  return fs.existsSync(lic) ? lic : standInFile('archivo-narrow');
}

export async function newProofDoc(title: string, subject: string): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setCreator('Plaque Proof Studio - Impact Signs');
  doc.setProducer('Plaque Proof Studio');
  doc.setSubject(subject);
  const emb = (f: string) => doc.embedFont(fs.readFileSync(f), { subset: true });
  const fonts: Fonts = {
    label: await emb(proofLabelFontFile().file),
    labelBold: await emb(proofLabelFontFile(true).file),
    helv: await emb(helveticaFile()),
    helvBold: await emb(helveticaFile(true)),
    narrow: await emb(narrowFile()),
  };
  return { doc, fonts };
}

// ---------- Text ----------
export function text(page: PDFPage, font: PDFFont, s: string, x: number, baseline: number, size: number, color = COLORS.ink, align: 'left' | 'center' | 'right' = 'left') {
  const w = font.widthOfTextAtSize(s, size);
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  page.drawText(s, { x: left, y: Y(baseline), size, font, color });
  return w;
}

/** Wraps words to a width; returns lines. */
export function wrap(font: PDFFont, s: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(t, size) <= maxWidth) line = t;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// ---------- Lines and shapes ----------
export function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number, thickness: number, color = COLORS.dimRed) {
  page.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness, color });
}

export function rect(page: PDFPage, x: number, y: number, w: number, h: number, color: RGB) {
  page.drawRectangle({ x, y: Y(y + h), width: w, height: h, color });
}

/** Filled triangle arrowhead pointing from (x,y) in direction (dx,dy). */
export function arrowhead(page: PDFPage, x: number, y: number, dx: number, dy: number, len: number, color: RGB) {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const bx = x - ux * len;
  const by = y - uy * len;
  const px = -uy * len * 0.35;
  const py = ux * len * 0.35;
  page.drawSvgPath(`M ${x} ${y} L ${bx + px} ${by + py} L ${bx - px} ${by - py} Z`, { x: 0, y: PAGE.h, color, borderWidth: 0 });
}

// ---------- Vector shapes exported from the real proofs (wordmark, person) ----------
interface VectorShape {
  bbox: [number, number, number, number];
  paths: { d: string; fill: string; evenOdd: boolean }[];
}
let vectors: Record<string, VectorShape> | null = null;
function getVectors() {
  vectors ??= JSON.parse(fs.readFileSync(fromRoot('server/templates/vectors.json'), 'utf8'));
  return vectors!;
}

/** Draws a stored vector shape so its bbox's top-left lands at (x, y) (top-down), scaled by s. */
export function drawShape(page: PDFPage, name: 'wordmark' | 'person', x: number, y: number, s = 1) {
  const shape = getVectors()[name];
  const [bx, by] = shape.bbox;
  const tx = (px: number) => x + (px - bx) * s;
  const ty = (py: number) => PAGE.h - (y + (py - by) * s);
  for (const p of shape.paths) {
    const ops: PDFOperator[] = [pushGraphicsState(), setFillingColor(hex(p.fill))];
    const tokens = p.d.match(/[MLCHVZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
    let i = 0;
    let cx = 0;
    let cy = 0;
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
      const cmd = tokens[i++];
      if (cmd === 'M') {
        cx = num();
        cy = num();
        ops.push(moveTo(tx(cx), ty(cy)));
      } else if (cmd === 'L') {
        cx = num();
        cy = num();
        ops.push(lineTo(tx(cx), ty(cy)));
      } else if (cmd === 'H') {
        cx = num();
        ops.push(lineTo(tx(cx), ty(cy)));
      } else if (cmd === 'V') {
        cy = num();
        ops.push(lineTo(tx(cx), ty(cy)));
      } else if (cmd === 'C') {
        const a = [num(), num(), num(), num(), num(), num()];
        ops.push(appendBezierCurve(tx(a[0]), ty(a[1]), tx(a[2]), ty(a[3]), tx(a[4]), ty(a[5])));
        cx = a[4];
        cy = a[5];
      } else if (cmd === 'Z') ops.push(closePath());
    }
    ops.push(PDFOperator.of(p.evenOdd ? PDFOperatorNames.FillEvenOdd : PDFOperatorNames.FillNonZero), popGraphicsState());
    page.pushOperators(...ops);
  }
}

export function shapeSize(name: 'wordmark' | 'person') {
  const [x0, y0, x1, y1] = getVectors()[name].bbox;
  return { w: x1 - x0, h: y1 - y0 };
}

/** impactsigns.com wordmark (vector, from the real proof) with its top-left at (x, y). */
export function wordmark(page: PDFPage, x = 18, y = 575) {
  drawShape(page, 'wordmark', x, y);
}

// ---------- Template pieces cut from the real proofs ----------
const templateCache = new Map<string, PDFDocument>();

/** Places the region `box` (top-down x0,y0,x1,y1) of a template at the same spot on the page (or offset). */
export async function placeTemplate(doc: PDFDocument, page: PDFPage, name: string, box: [number, number, number, number], dx = 0, dy = 0) {
  let src = templateCache.get(name);
  if (!src) {
    src = await PDFDocument.load(fs.readFileSync(fromRoot('server/templates', `${name}.pdf`)));
    templateCache.set(name, src);
  }
  const [x0, y0, x1, y1] = box;
  const embedded = await doc.embedPage(src.getPage(0), { left: x0, right: x1, bottom: PAGE.h - y1, top: PAGE.h - y0 });
  page.drawPage(embedded, { x: x0 + dx, y: PAGE.h - y1 - dy });
}

// ---------- Images ----------
export async function embedImageFile(doc: PDFDocument, file: string, maxPx = 600) {
  const png = await sharp(file).resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).png().toBuffer();
  return doc.embedPng(png);
}

export async function embedSquare(doc: PDFDocument, file: string | null, fallbackHex: string) {
  if (file) return doc.embedPng(await sharp(file).resize(300, 300, { fit: 'cover' }).flatten({ background: '#ffffff' }).png().toBuffer());
  return doc.embedPng(await sharp({ create: { width: 64, height: 64, channels: 3, background: fallbackHex } }).png().toBuffer());
}

/** Draws an image fitted (contain) in a box, centered; returns the drawn rect. */
export function drawContain(page: PDFPage, img: { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  const r = { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
  page.drawImage(img as never, { x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h });
  return r;
}

export async function plaqueJpg(doc: PDFDocument, plaqueImage: Buffer, wPt: number, hPt: number) {
  const jpg = await sharp(plaqueImage).resize(Math.round(wPt * 4), Math.round(hPt * 4), { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
  return doc.embedJpg(jpg);
}

// ---------- Measurements ----------
/** 12 -> 12’’ ; 12.5 -> 12½’’ (two right single quotes, as on the standard proofs). */
export function dimLabel(v: number): string {
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const map: [number, string][] = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [0.125, '⅛'], [0.375, '⅜'], [0.625, '⅝'], [0.875, '⅞']];
  const hit = map.find(([f]) => Math.abs(f - frac) < 1e-6);
  const num = frac < 1e-6 ? String(whole) : hit ? `${whole || ''}${hit[1]}` : String(+v.toFixed(2));
  return `${num}’’`;
}

/** 6 -> 6.00” (Description sheets). */
export const decimalLabel = (v: number) => `${v.toFixed(2)}”`;

/** 7 -> 7" (order/version proofs). */
export const plainInchLabel = (v: number) => `${+v.toFixed(3)}"`;

/** Fraction text for order descriptions: 0.25 -> 1/4 */
export function fractionText(v: number): string {
  const f: Record<string, string> = { '0.25': '1/4', '0.375': '3/8', '0.5': '1/2', '0.625': '5/8', '0.75': '3/4', '0.125': '1/8' };
  const whole = Math.floor(v);
  const frac = +(v - whole).toFixed(3);
  if (!frac) return String(whole);
  return `${whole ? whole + ' ' : ''}${f[String(frac)] ?? frac}`;
}
