// Description-sheet proof (Awe, Raccoon River, Sax-Zim Bog, Hadar Family Hall).
// Measured on those four proofs:
//  - header: 3 lines of Helvetica 17.9 pt at baselines 21.1 / 42.4 / 63.7, x = 8.6;
//    "ORDER# n" Myriad Bold 20.5 pt right-aligned to 776.4 (baseline 43.9), "VERSION n" in red;
//    grey rule 70.8–72.0
//  - plaque left: box 32–477 x 101–557 (true size when it fits), blue #1A6EA6 0.22 pt
//    dimension lines with arrowheads and decimal labels (6.00”)
//  - captioned option tiles top-right; "Visual Scale" panel bottom-right: a 6 ft person on
//    the ground (garden stake), beside an 8 ft wall (wall mount), or the customer's site photo
//  - without a scale panel (Sax-Zim Bog) the plaque is centered and the tiles run along the bottom
//  - footer: navy rule 572.2–573.4 full width, centered impactsigns.com wordmark
import fs from 'node:fs';
import sharp from 'sharp';
import { degrees, type PDFFont } from 'pdf-lib';
import { findOption, fontLabel, mustOption, paintHex, paintLabel } from '../../catalog.js';
import { findAsset } from '../../assets.js';
import { resolveFont } from '../../text/fonts.js';
import type { ProofInput } from './index.js';
import {
  COLORS, PAGE, Y, arrowhead, decimalLabel, drawContain, drawShape, embedImageFile, fractionText, line, newProofDoc, plaqueJpg, rect, shapeSize, text, wordmark, wrap,
} from './common.js';
import { autoDescription, finishPhrase, materialPhrase, mountingPhrase } from './description-text.js';

const inch = (v: number) => `${+v.toFixed(3)}”`;

export function descriptionPlaqueRect(widthIn: number, heightIn: number, withPanel: boolean) {
  const box = withPanel ? { cx: 254.6, cy: 318, maxW: 444, maxH: 456 } : { cx: 397.4, cy: 264.4, maxW: 485, maxH: 304 };
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
  const mode = input.visualScale ?? 'person';
  const withPanel = mode !== 'none';

  // ---- Header ----
  // Three paragraphs at 17.9 pt; ORDER# sits at the right end of whichever of lines 2-3 is shorter.
  const description = (input.description?.trim() || autoDescription(spec, input.wording, { fontStated: input.fontStated })).replace(/\r/g, '');
  const order = `ORDER# ${input.jobNumber}`;
  const version = input.version > 1 ? `VERSION ${input.version}` : '';
  const orderW = fonts.labelBold.widthOfTextAtSize(order, 20.5) + (version ? fonts.labelBold.widthOfTextAtSize(` ${version}`, 20.5) : 0);
  let size = 17.9;
  let lines: string[] = [];
  let orderLine = 1;
  for (; size >= 10; size -= 0.4) {
    lines = description.split('\n').flatMap((para) => wrap(fonts.helv, para, size, 778));
    if (lines.length > 3) continue;
    const widths = lines.map((l) => fonts.helv.widthOfTextAtSize(l, size));
    const candidates = [1, 2].filter((i) => i < lines.length || i === lines.length);
    orderLine = candidates.reduce((a, b) => ((widths[b] ?? 0) < (widths[a] ?? 0) ? b : a), candidates[0]);
    if ((widths[orderLine] ?? 0) + orderW + 18 <= 778) break;
  }
  lines.forEach((l, i) => text(page, fonts.helv, l, 8.6, 21.1 + i * 21.3, size));
  const orderBaseline = 21.1 + orderLine * 21.3 + 1.4;
  const ox = 776.4 - orderW;
  text(page, fonts.labelBold, order, ox, orderBaseline, 20.5);
  if (version) text(page, fonts.labelBold, ` ${version}`, ox + fonts.labelBold.widthOfTextAtSize(order, 20.5), orderBaseline, 20.5, COLORS.red);
  page.drawRectangle({ x: 2.1, y: Y(72.0), width: 789.6, height: 1.2, color: COLORS.grey });

  // ---- Plaque + blue dimensions ----
  const r = descriptionPlaqueRect(spec.widthIn, spec.heightIn, withPanel);
  const plaque = await plaqueJpg(doc, input.plaqueImage, r.w, r.h);
  page.drawImage(plaque, { x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h });
  const dimSize = 22;
  // Top
  const ty = r.y - 17.5;
  const wl = decimalLabel(spec.widthIn);
  const wlw = fonts.helv.widthOfTextAtSize(wl, dimSize);
  const midX = r.x + r.w / 2;
  line(page, r.x, ty, midX - wlw / 2 - 5, ty, 0.5, COLORS.blue);
  line(page, midX + wlw / 2 + 5, ty, r.x + r.w, ty, 0.5, COLORS.blue);
  line(page, r.x, ty - 6, r.x, ty + 6, 0.5, COLORS.blue);
  line(page, r.x + r.w, ty - 6, r.x + r.w, ty + 6, 0.5, COLORS.blue);
  arrowhead(page, r.x, ty, -1, 0, 6, COLORS.blue);
  arrowhead(page, r.x + r.w, ty, 1, 0, 6, COLORS.blue);
  text(page, fonts.helv, wl, midX, ty + 7.6, dimSize, COLORS.blue, 'center');
  // Left (label reads bottom to top)
  const lx = r.x - 17.5;
  const hl = decimalLabel(spec.heightIn);
  const hlw = fonts.helv.widthOfTextAtSize(hl, dimSize);
  const midY = r.y + r.h / 2;
  line(page, lx, r.y, lx, midY - hlw / 2 - 5, 0.5, COLORS.blue);
  line(page, lx, midY + hlw / 2 + 5, lx, r.y + r.h, 0.5, COLORS.blue);
  line(page, lx - 6, r.y, lx + 6, r.y, 0.5, COLORS.blue);
  line(page, lx - 6, r.y + r.h, lx + 6, r.y + r.h, 0.5, COLORS.blue);
  arrowhead(page, lx, r.y, 0, -1, 6, COLORS.blue);
  arrowhead(page, lx, r.y + r.h, 0, 1, 6, COLORS.blue);
  page.drawText(hl, { x: lx + dimSize * 0.36, y: Y(midY + hlw / 2), size: dimSize, font: fonts.helv, color: COLORS.blue, rotate: degrees(90) });

  // Minimum-letter-height callout (Raccoon River).
  const smallest = input.layout?.lines.reduce((a, b) => (b.size < a.size ? b : a), input.layout.lines[0]);
  if (input.layout?.minLetterIn != null && input.layout.minLetterIn <= 0.26 && smallest) {
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

  if (withPanel) {
    // Awe: two columns with "Font: …" underneath; Raccoon River: three columns.
    const x0 = Math.max(r.x + r.w + 24, 425);
    const cols = tiles.length >= 5 ? 3 : 2;
    const cw = (781 - x0) / cols;
    for (let i = 0; i < tiles.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      await drawTile(tiles[i], x0 + col * cw, row === 0 ? 82 : 196, cw, row === 0 ? 76 : 70, 7.6);
    }
    if (showFont) {
      const label = 'Font: ';
      const lw = fonts.helv.widthOfTextAtSize(label, 12.4);
      const nw = fontFace.widthOfTextAtSize(fontLabel(spec), 12.4);
      const fx = x0 + (781 - x0) / 2 - (lw + nw) / 2;
      text(page, fonts.helv, label, fx, 300, 12.4);
      text(page, fontFace, fontLabel(spec), fx + lw, 300, 12.4);
    }
  } else {
    // Sax-Zim Bog: tiles along the bottom, the font as the last tile.
    if (showFont) tiles.push({ image: null, caption: [], fontTile: { name: fontLabel(spec), font: fontFace } });
    const cw = 760 / tiles.length;
    for (let i = 0; i < tiles.length; i++) await drawTile(tiles[i], 16 + i * cw, 452, cw, 62, 11);
  }

  // ---- Visual scale panel ----
  if (mode === 'person') {
    const ground = mounting.scale === 'ground';
    const person = shapeSize('person');
    if (ground) {
      // Awe: ground band, 6 ft person, plaque on its stake, all at one scale.
      const groundY = 529.5;
      const k = 182.9 / 72; // pt per inch (person 72 in tall)
      rect(page, 485.2, groundY, 295.9, 31.7, COLORS.ground);
      rect(page, 485.2, groundY - 2.6, 295.9, 2.6, COLORS.grass);
      const s = 182.9 / person.h;
      drawShape(page, 'person', 509, groundY - 182.9, s);
      line(page, 503.2, groundY - 182.9, 503.2, groundY - 98, 0.5, COLORS.red);
      line(page, 503.2, groundY - 84, 503.2, groundY, 0.5, COLORS.red);
      text(page, fonts.helv, '6 FT', 503.2, groundY - 88.5, 9, COLORS.red, 'center');
      const stake = (spec.stakeLengthIn ?? 24) * 0.7 * k;
      const pw = spec.widthIn * k;
      const ph = spec.heightIn * k;
      const pcx = 655;
      line(page, pcx, groundY, pcx, groundY - stake, 1.4, COLORS.ink);
      page.drawImage(plaque, { x: pcx - pw / 2, y: Y(groundY - stake), width: pw, height: ph });
      text(page, fonts.helv, 'Visual Scale of Signage', 566.2, 372.2, 11.5, COLORS.red);
    } else {
      // Raccoon River: 8 ft wall square, 6 ft person beside it, plaque on the wall at scale.
      const wall = { x: 529.6, y: 329.7, s: 234.1 };
      const k = wall.s / 96;
      page.drawRectangle({ x: wall.x, y: Y(wall.y + wall.s), width: wall.s, height: wall.s, borderColor: COLORS.ink, borderWidth: 0.5 });
      const ph = 72 * k;
      drawShape(page, 'person', 498, wall.y + wall.s - ph, ph / person.h);
      const floor = wall.y + wall.s;
      line(page, 478.6, floor - ph, 478.6, floor, 0.35, COLORS.red);
      arrowhead(page, 478.6, floor - ph, 0, -1, 4, COLORS.red);
      arrowhead(page, 478.6, floor, 0, 1, 4, COLORS.red);
      page.drawText('72.00” - 6FT Tall', { x: 476.4, y: Y(floor - ph / 2 - 30), size: 6.5, font: fonts.helv, color: COLORS.red, rotate: degrees(90) });
      line(page, 772, wall.y, 772, floor, 0.35, COLORS.red);
      arrowhead(page, 772, wall.y, 0, -1, 4, COLORS.red);
      arrowhead(page, 772, floor, 0, 1, 4, COLORS.red);
      page.drawText('96.00” - 8 FT Tall', { x: 779.5, y: Y(floor - wall.s / 2 - 28), size: 6.5, font: fonts.helv, color: COLORS.red, rotate: degrees(90) });
      const centerIn = input.siteMountHeightIn ?? 60;
      const pw = spec.widthIn * k;
      const phh = spec.heightIn * k;
      page.drawImage(plaque, { x: wall.x + wall.s / 2 + 18 - pw / 2, y: Y(floor - centerIn * k + phh / 2), width: pw, height: phh });
      text(page, fonts.helv, 'Visual Scale', wall.x, wall.y - 6, 11.5, COLORS.red);
    }
  } else if (mode === 'site' && input.sitePhoto) {
    // Hadar: the customer's wall with the plaque placed on it, flagged as approximate.
    const P = { x: 490.2, y: 335.2, w: 298.5, h: 232.1 };
    const photo = await sharp(input.sitePhoto).resize(Math.round(P.w * 3), Math.round(P.h * 3), { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
    page.drawImage(await doc.embedJpg(photo), { x: P.x, y: Y(P.y + P.h), width: P.w, height: P.h });
    const pw = P.w * 0.25;
    const phh = (pw * spec.heightIn) / spec.widthIn;
    const pcx = P.x + P.w * 0.5;
    const pcy = P.y + P.h * 0.38;
    page.drawImage(plaque, { x: pcx - pw / 2, y: Y(pcy + phh / 2), width: pw, height: phh });
    if (input.siteMountHeightIn) {
      const ax = pcx + pw / 2 + 10;
      const bottom = P.y + P.h - 8;
      line(page, ax, pcy - phh / 2, ax, bottom, 0.6, COLORS.red);
      arrowhead(page, ax, pcy - phh / 2, 0, -1, 4, COLORS.red);
      arrowhead(page, ax, bottom, 0, 1, 4, COLORS.red);
      page.drawText(decimalLabel(input.siteMountHeightIn), { x: ax + 10, y: Y((pcy + bottom) / 2 + 18), size: 12, font: fonts.helv, color: COLORS.red, rotate: degrees(90) });
    }
    text(page, fonts.helv, 'NOTE: DRAWING IS AT APPROXIMATE SIZE.', P.x + P.w / 2, 312, 11.5, COLORS.red, 'center');
    text(page, fonts.helv, 'NOT TO EXACT SCALE.', P.x + P.w / 2, 327, 11.5, COLORS.red, 'center');
  }

  // ---- Footer ----
  page.drawRectangle({ x: 0.3, y: Y(573.4), width: 791.2, height: 1.2, color: COLORS.navy });
  wordmark(page, 311.8, 576.9);
  return Buffer.from(await doc.save());
}
