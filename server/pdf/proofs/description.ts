// Description-sheet proof: the one proof style the studio makes.
// Measured on the real Awe, Raccoon River, Sax-Zim Bog and Hadar Family Hall proofs:
//  - "ORDER# n" Myriad Bold 20.5 pt right-aligned to 776.4 (baseline 43.9), "VERSION n" in red;
//    grey rule 70.8–72.0
//  - plaque: blue #1A6EA6 0.22 pt dimension lines with arrowheads and decimal labels (6.00”)
//  - captioned option tiles
//  - footer: navy rule 572.2–573.4 full width, centered impactsigns.com wordmark
// Page arrangement (a deliberate departure from the real proofs, which put the description in a
// three-line header across the top and a Visual Scale figure bottom-right; neither is made now):
//  - left: the plaque (and its width and height lines) takes the whole page height down to the
//    navy rule, true size when it fits; the width label keeps a gap under the page top and the
//    height line keeps a gap above the navy rule
//  - top right: ORDER# / VERSION where they always were, then the description from y = 82
//  - bottom right: the option tiles (and the Font line), in the same arrangement as before,
//    resting just above the navy rule
import fs from 'node:fs';
import sharp from 'sharp';
import { degrees, type PDFFont } from 'pdf-lib';
import { findOption, fontLabel, mustOption, paintHex, paintLabel } from '../../catalog.js';
import { findAsset } from '../../assets.js';
import { resolveFont } from '../../text/fonts.js';
import type { ProofInput } from './index.js';
import {
  COLORS, PAGE, Y, arrowhead, decimalLabel, drawContain, embedImageFile, fractionText, line, newProofDoc, plaqueJpg, text, wordmark, wrap,
} from './common.js';
import { autoDescription, finishPhrase, materialPhrase, mountingPhrase } from './description-text.js';

const inch = (v: number) => `${+v.toFixed(3)}”`;
/** Description type size (17.9 pt, as in the measured header); lines are set at 1.19 × the size. */
const DESC_SIZE = 17.9;
/** Where the right-hand column starts under ORDER#; tiles and description both begin here. */
const COLUMN_TOP = 82;
/** The bottom of the left plaque and the right-hand tile block: clear of the navy rule at 572.2. */
const CONTENT_BOTTOM = 556;

/**
 * The plaque box: true size when it fits, in the left column, x 32–477 and y 40–556.
 * The width line sits 14 pt above the plaque and its 22 pt label rises ~8.5 pt above that line,
 * so the label stays ~17 pt under the page top; the height line ends at the plaque's bottom edge,
 * ~16 pt above the navy footer rule (572.2).
 */
export function descriptionPlaqueRect(widthIn: number, heightIn: number) {
  const box = { cx: 254.6, cy: 298, maxW: 444, maxH: 516 };
  const s = Math.min(72, box.maxW / widthIn, box.maxH / heightIn);
  const w = widthIn * s;
  const h = heightIn * s;
  return { x: box.cx - w / 2, y: box.cy - h / 2, w, h, scale: s };
}

interface Tile {
  image: Buffer | string | null;
  caption: string[];
  /** Text tile ("Font: Times New Roman"). */
  fontTile?: { name: string; font: PDFFont };
}

async function tintedTexture(textureAsset: string | null, hexColor: string): Promise<Buffer> {
  const n = parseInt(hexColor.slice(1), 16);
  const tint = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  if (!textureAsset) return sharp({ create: { width: 200, height: 200, channels: 3, background: hexColor } }).png().toBuffer();
  // Texture photo in the paint color: keep the grain, take the color.
  const grey = await sharp(textureAsset).resize(200, 200, { fit: 'cover' }).greyscale().normalise({ lower: 2, upper: 98 }).png().toBuffer();
  const color = await sharp({ create: { width: 200, height: 200, channels: 3, background: tint } }).png().toBuffer();
  return sharp(color).composite([{ input: grey, blend: 'soft-light' }]).png().toBuffer();
}

function imageCaption(id: string): string[] {
  switch (id) {
    case 'full-color-uv':
      return ['Full Color UV', 'printed photo'];
    case 'photo-relief':
      return ['Photo relief', 'image'];
    case 'bas-relief':
      return ['Sculpted bas', 'relief image'];
    case 'etched-photo':
      return ['Etched', 'photo'];
    default:
      return [];
  }
}

export async function buildDescriptionProof(input: ProofInput): Promise<Buffer> {
  const { spec } = input;
  const { doc, fonts } = await newProofDoc(`Proof - ${input.jobNumber}`, JSON.stringify(spec));
  const page = doc.addPage([PAGE.w, PAGE.h]);

  // ---- ORDER# / VERSION (the grey rule under them is drawn once the right column's left edge is known) ----
  const description = (input.description?.trim() || autoDescription(spec, input.wording, { exactDesign: !!input.layout?.exactDesign, fontStated: input.fontStated, photoCount: input.layout?.imageFrames.length, logoCount: input.layout?.logos.length })).replace(/\r/g, '');
  const order = `ORDER# ${input.jobNumber}`;
  const version = input.version > 1 ? `VERSION ${input.version}` : '';
  const orderW = fonts.labelBold.widthOfTextAtSize(order, 20.5) + (version ? fonts.labelBold.widthOfTextAtSize(` ${version}`, 20.5) : 0);
  const orderBaseline = 43.9;
  const ox = 776.4 - orderW;
  text(page, fonts.labelBold, order, ox, orderBaseline, 20.5);
  if (version) text(page, fonts.labelBold, ` ${version}`, ox + fonts.labelBold.widthOfTextAtSize(order, 20.5), orderBaseline, 20.5, COLORS.red);

  // ---- Plaque + blue dimensions ----
  const r = descriptionPlaqueRect(spec.widthIn, spec.heightIn);
  const plaque = await plaqueJpg(doc, input.plaqueImage, r.w, r.h);
  page.drawImage(plaque, { x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h });
  // A label too long for a short span is stepped down until it fits between the arrows.
  const DIM_SIZE = 22;
  const DIM_GAP = 5; // line to label
  const DIM_ARROW = 6;
  const fitDim = (label: string, span: number) => {
    let size = DIM_SIZE;
    while (size > 9 && fonts.helv.widthOfTextAtSize(label, size) + 2 * (DIM_GAP + DIM_ARROW + 1) > span) size -= 0.5;
    return size;
  };
  // Top
  const ty = r.y - 14;
  const wl = decimalLabel(spec.widthIn);
  const wSize = fitDim(wl, r.w);
  const wlw = fonts.helv.widthOfTextAtSize(wl, wSize);
  const midX = r.x + r.w / 2;
  line(page, r.x, ty, midX - wlw / 2 - DIM_GAP, ty, 0.5, COLORS.blue);
  line(page, midX + wlw / 2 + DIM_GAP, ty, r.x + r.w, ty, 0.5, COLORS.blue);
  line(page, r.x, ty - 6, r.x, ty + 6, 0.5, COLORS.blue);
  line(page, r.x + r.w, ty - 6, r.x + r.w, ty + 6, 0.5, COLORS.blue);
  arrowhead(page, r.x, ty, -1, 0, DIM_ARROW, COLORS.blue);
  arrowhead(page, r.x + r.w, ty, 1, 0, DIM_ARROW, COLORS.blue);
  text(page, fonts.helv, wl, midX, ty + wSize * 0.345, wSize, COLORS.blue, 'center');
  // Left (label reads bottom to top)
  const lx = r.x - 17.5;
  const hl = decimalLabel(spec.heightIn);
  const hSize = fitDim(hl, r.h);
  const hlw = fonts.helv.widthOfTextAtSize(hl, hSize);
  const midY = r.y + r.h / 2;
  line(page, lx, r.y, lx, midY - hlw / 2 - DIM_GAP, 0.5, COLORS.blue);
  line(page, lx, midY + hlw / 2 + DIM_GAP, lx, r.y + r.h, 0.5, COLORS.blue);
  line(page, lx - 6, r.y, lx + 6, r.y, 0.5, COLORS.blue);
  line(page, lx - 6, r.y + r.h, lx + 6, r.y + r.h, 0.5, COLORS.blue);
  arrowhead(page, lx, r.y, 0, -1, DIM_ARROW, COLORS.blue);
  arrowhead(page, lx, r.y + r.h, 0, 1, DIM_ARROW, COLORS.blue);
  page.drawText(hl, { x: lx + hSize * 0.36, y: Y(midY + hlw / 2), size: hSize, font: fonts.helv, color: COLORS.blue, rotate: degrees(90) });

  // Minimum-letter-height callout (Raccoon River).
  const smallest = input.layout?.lines.reduce((a, b) => (b.size < a.size ? b : a), input.layout.lines[0]);
  const callout = input.layout?.minLetterIn != null && input.layout.minLetterIn <= 0.26 && !!smallest;
  if (callout && smallest) {
    const tx = r.x + r.w + 8;
    const tyy = Math.min(r.y + r.h - 30, Math.max(r.y + 20, r.y + (smallest.baseline / spec.heightIn) * r.h));
    ['1/4” tall minimum size', 'for casting lower case', 'lettering.'].forEach((l, i) => text(page, fonts.helv, l, tx + 10, tyy + i * 5.6, 5.4, COLORS.red));
    line(page, tx + 8, tyy - 2, r.x + r.w - 3, tyy - 2, 0.35, COLORS.red);
    arrowhead(page, r.x + r.w - 3, tyy - 2, -1, 0, 3.5, COLORS.red);
  }

  // ---- Tiles ----
  const finish = mustOption('finishes', spec.finish);
  const texture = findOption('backgroundTextures', spec.backgroundTexture);
  const border = mustOption('borders', spec.border);
  const mounting = mustOption('mountings', spec.mounting);
  const plateTile = finish.id === 'natural-satin-brushed-bronze' ? findAsset('assets/description-tiles/plate.png') : findAsset(finish.asset);
  const fontRes = resolveFont(spec.font);
  const fontFace = await doc.embedFont(fs.readFileSync(fontRes.file), { subset: true });
  const tiles: Tile[] = [
    {
      image: plateTile,
      caption: spec.thicknessIn
        ? [`${fractionText(spec.thicknessIn)}” thick`, `${finish.proofLabel ?? finish.label} Plaque`]
        : [`${inch(spec.widthIn)}x${inch(spec.heightIn)} ${materialPhrase(spec)}`, finishPhrase(spec)],
    },
    {
      image: await tintedTexture(findAsset(texture?.asset), paintHex(spec)),
      caption: [`Background painted ${paintLabel(spec)}`, texture && texture.id !== 'smooth' ? `with ${texture.label} texture.` : 'smooth background.'],
    },
  ];
  if (spec.imageOption !== 'none') {
    tiles.push({ image: findAsset(mustOption('imageOptions', spec.imageOption).asset), caption: imageCaption(spec.imageOption) });
  }
  tiles.push({
    image: findAsset(`assets/description-tiles/border-${border.id}.png`) ?? findAsset(border.asset),
    caption: [border.id === 'none' ? 'No border.' : `${border.label.replace(/ Border$/, '')} border.`],
  });
  const mp = mountingPhrase(spec).replace(/\.$/, '');
  const mpLines = wrap(fonts.helv, mp, 9, 90);
  tiles.push({ image: findAsset(mounting.tile as string | undefined) ?? findAsset(mounting.diagram as string | undefined), caption: mpLines });
  const showFont = spec.font === 'custom' || input.fontStated;

  const drawTile = async (t: Tile, x: number, y: number, w: number, imgH: number, capSize: number) => {
    if (t.fontTile) {
      const nameLines = wrap(t.fontTile.font, t.fontTile.name, 13, w);
      const top = y + imgH / 2 - (nameLines.length * 14) / 2;
      text(page, fonts.helv, 'Font:', x + w / 2, top, 12.4, COLORS.ink, 'center');
      nameLines.forEach((l, i) => text(page, t.fontTile!.font, l, x + w / 2, top + 15 + i * 14, 13, COLORS.ink, 'center'));
      return;
    }
    if (t.image) {
      const img = typeof t.image === 'string' ? await embedImageFile(doc, t.image) : await doc.embedPng(t.image);
      drawContain(page, img, x + 4, y, w - 8, imgH);
    }
    const cap = t.caption.flatMap((c) => wrap(fonts.helv, c, capSize, w - 4));
    cap.forEach((l, i) => text(page, fonts.helv, l, x + w / 2, y + imgH + capSize + 3 + i * (capSize * 1.18), capSize, COLORS.ink, 'center'));
  };

  // Awe: two columns with "Font: …" underneath; Raccoon River: three columns.
  // The red callout (when there is one) keeps its own room beside the plaque, so no tile covers it.
  const x0 = Math.max(r.x + r.w + 24, 425, callout ? r.x + r.w + 84 : 0);
  const cols = tiles.length >= 5 ? 3 : 2;
  const cw = (781 - x0) / cols;
  const CAP = 7.6;
  const ROW_Y = [0, 114]; // tile rows, from the top of the tile block
  const ROW_IMG_H = [76, 70];
  const FONT_Y = 218; // baseline of the Font line, from the top of the tile block

  // The tile block rests on the bottom edge: measure it, then place its top.
  const rowCount = Math.ceil(tiles.length / cols);
  const lastRow = rowCount - 1;
  const lastRowLines = Math.max(1, ...tiles.slice(lastRow * cols).map((t) => t.caption.flatMap((c) => wrap(fonts.helv, c, CAP, cw - 4)).length));
  const lastRowBottom = ROW_Y[lastRow] + ROW_IMG_H[lastRow] + CAP + 3 + (lastRowLines - 1) * CAP * 1.18 + 2;
  const blockH = showFont ? Math.max(lastRowBottom, FONT_Y + 3) : lastRowBottom;
  const blockTop = CONTENT_BOTTOM - blockH;
  for (let i = 0; i < tiles.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    await drawTile(tiles[i], x0 + col * cw, blockTop + ROW_Y[row], cw, ROW_IMG_H[row], CAP);
  }
  if (showFont) {
    const label = 'Font: ';
    const lw = fonts.helv.widthOfTextAtSize(label, 12.4);
    const nw = fontFace.widthOfTextAtSize(fontLabel(spec), 12.4);
    const fx = x0 + (781 - x0) / 2 - (lw + nw) / 2;
    text(page, fonts.helv, label, fx, blockTop + FONT_Y, 12.4);
    text(page, fontFace, fontLabel(spec), fx + lw, blockTop + FONT_Y, 12.4);
  }

  // ---- Description (top right, under ORDER#, where the tiles used to be) ----
  page.drawRectangle({ x: x0, y: Y(72.0), width: 781 - x0, height: 1.2, color: COLORS.grey });
  // Full header size wherever it fits the space above the tiles; otherwise the smallest step down that does.
  const descBottom = blockTop - 14;
  let size = DESC_SIZE;
  let lines: string[] = [];
  for (; size >= 7; size -= 0.4) {
    lines = description.split('\n').flatMap((para) => wrap(fonts.helv, para, size, 781 - x0));
    if (COLUMN_TOP + size + (lines.length - 1) * size * 1.19 <= descBottom) break;
  }
  lines.forEach((l, i) => text(page, fonts.helv, l, x0, COLUMN_TOP + size + i * size * 1.19, size));

  // ---- Footer ----
  page.drawRectangle({ x: 0.3, y: Y(573.4), width: 791.2, height: 1.2, color: COLORS.navy });
  wordmark(page, 311.8, 576.9);
  return Buffer.from(await doc.save());
}
