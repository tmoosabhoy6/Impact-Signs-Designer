// Flat, exact drawing of a plaque layout (SVG -> PNG).
// It is sent to the image model as the "layout reference": the model keeps every
// position and every letter, and only turns the flat drawing into real cast metal.
// It is also used as the stand-in concept image in mock mode.
import sharp from 'sharp';
import { mustOption, paintHex } from '../catalog.js';
import { loadFontFile, measure, resolveFont, textPath } from '../text/fonts.js';
import { inkMask, TRACE_EDGE } from '../pdf/trace.js';
import type { PlaqueLayout, PlaqueSpec, TextLine } from '../../shared/types.js';

/** One line of a layout as SVG path data (centered on cx, or from x when left-aligned). */
export function linePathData(line: TextLine, fallbackFontId: string, unitsPerIn: number): string {
  const face = line.face ? loadFontFile(line.face) : resolveFont(fallbackFontId).font;
  const k = unitsPerIn;
  const sc = line.style?.smallCaps;
  const width = measure(face, line.text, line.size, sc);
  const x = line.x ?? line.cx - width / 2;
  return textPath(face, line.text, x * k, line.baseline * k, line.size * k, sc);
}

/** All text of a layout as one SVG path, in the given units per inch. */
export function layoutTextPath(layout: PlaqueLayout, fontId: string, unitsPerIn: number): string {
  return layout.lines.map((l) => linePathData(l, fontId, unitsPerIn)).join(' ');
}

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

export interface FlatOptions {
  pxPerIn: number;
  /** Prepared photos (already toned for the image option) as PNG, one per `layout.imageFrames` entry. */
  photoPngs?: (Buffer | null)[];
  /** Logo PNGs, one per `layout.logos` entry. */
  logoPngs?: (Buffer | null)[];
}

export async function preparePhoto(photo: Buffer, imageOption: string, finishHex: string): Promise<Buffer> {
  if (imageOption === 'full-color-uv') return sharp(photo).flatten({ background: '#ffffff' }).png().toBuffer();
  // Relief and etched images read as monotone metal: greyscale, then tinted with the metal color.
  const n = parseInt(finishHex.slice(1), 16);
  const tint = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  const grey = await sharp(photo).flatten({ background: '#808080' }).greyscale().normalise().png().toBuffer();
  if (imageOption === 'etched-photo') return sharp(grey).toColourspace('srgb').tint({ r: 70, g: 55, b: 40 }).png().toBuffer();
  return sharp(grey).toColourspace('srgb').tint(tint).png().toBuffer();
}

/** Padding of the raised plate around a UV printed logo, as a share of the logo's size. */
export const UV_PLATE_PAD = 0.08;

/**
 * A logo as it will be made, read with the same tracer the vector production file uses, so
 * Reference 1 and the production file agree:
 *  - raised cast: the logo's ink becomes raised metal in the plaque finish and everything
 *    else is see-through, so the recessed field shows there;
 *  - UV print: a raised metal plate with the complete artwork, monochrome or color.
 */
export async function logoForDrawing(png: Buffer, treatment = 'raised-cast', metalHex = '#C49A6C'): Promise<Buffer> {
  const mode = mustOption('logoTreatments', treatment).mode;
  if (mode !== 'raised') {
    // Printing uses the entire original artwork, never the casting threshold. White ink,
    // pale colors and negative spaces must not disappear or become bronze windows.
    let art = sharp(png).rotate().resize({ width: TRACE_EDGE, height: TRACE_EDGE, fit: 'inside' });
    if (mode === 'monochrome') art = art.greyscale().toColourspace('srgb');
    const { data, info } = await art.png().toBuffer({ resolveWithObject: true });
    const padX = Math.max(2, Math.round(info.width * UV_PLATE_PAD));
    const padY = Math.max(2, Math.round(info.height * UV_PLATE_PAD));
    return sharp({ create: { width: info.width + 2 * padX, height: info.height + 2 * padY, channels: 4, background: metalHex } })
      .composite([{ input: data, left: padX, top: padY }]).png().toBuffer();
  }
  const mask = await inkMask(png);
  const n = parseInt(metalHex.slice(1), 16);
  const metal = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const out = Buffer.alloc(mask.width * mask.height * 4);
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    out[i * 4] = metal[0];
    out[i * 4 + 1] = metal[1];
    out[i * 4 + 2] = metal[2];
    out[i * 4 + 3] = 255;
  }
  return sharp(out, { raw: { width: mask.width, height: mask.height, channels: 4 } }).png().toBuffer();
}

export function layoutToSvg(layout: PlaqueLayout, spec: PlaqueSpec, opts: FlatOptions): string {
  const k = opts.pxPerIn;
  const W = layout.widthIn * k;
  const H = layout.heightIn * k;
  const finish = mustOption('finishes', spec.finish);
  const metal = finish.hex ?? '#C49A6C';
  const field = paintHex(spec);
  const rr = (x: { x: number; y: number; w: number; h: number }) =>
    `x="${(x.x * k).toFixed(2)}" y="${(x.y * k).toFixed(2)}" width="${(x.w * k).toFixed(2)}" height="${(x.h * k).toFixed(2)}"`;
  const r = (x: { x: number; y: number; w: number; h: number }) =>
    `x="${(x.x * k).toFixed(2)}" y="${(x.y * k).toFixed(2)}" width="${(x.w * k).toFixed(2)}" height="${(x.h * k).toFixed(2)}"`;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${metal}"/>`);
  parts.push(`<rect ${r(layout.field)} fill="${field}"/>`);
  if (layout.border.innerLine && layout.border.innerLineIn) {
    parts.push(`<rect ${r(layout.border.innerLine)} fill="none" stroke="${metal}" stroke-width="${(layout.border.innerLineIn * k).toFixed(2)}"/>`);
  }
  if (layout.border.id === 'bevel-edge') {
    const b = layout.border.widthIn * k;
    parts.push(`<path d="M0 0 L${W} 0 L${W - b} ${b} L${b} ${b} Z" fill="${shade(metal, 0.25)}"/>`);
    parts.push(`<path d="M0 ${H} L${W} ${H} L${W - b} ${H - b} L${b} ${H - b} Z" fill="${shade(metal, -0.2)}"/>`);
  }
  layout.imageFrames.forEach((f, i) => {
    const png = opts.photoPngs?.[i];
    parts.push(`<rect ${r(f.outer)} fill="${metal}"/>`);
    if (png) {
      parts.push(`<image ${r(f.inner)} preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${png.toString('base64')}"/>`);
    } else {
      parts.push(`<rect ${r(f.inner)} fill="${shade(metal, -0.35)}"/>`);
    }
  });
  layout.logos.forEach((logo, i) => {
    const png = opts.logoPngs?.[i];
    if (png) {
      parts.push(`<image ${r(logo)} preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${png.toString('base64')}"/>`);
    } else {
      parts.push(`<rect ${r(logo)} fill="none" stroke="${metal}" stroke-dasharray="6 4" stroke-width="2"/>`);
    }
  });
  for (const r of layout.rules ?? []) parts.push(`<rect ${rr(r)} fill="${metal}"/>`);
  for (const sc of layout.screws ?? []) {
    parts.push(`<circle cx="${(sc.cx * k).toFixed(2)}" cy="${(sc.cy * k).toFixed(2)}" r="${((sc.d / 2) * k).toFixed(2)}" fill="${shade(metal, 0.15)}" stroke="${shade(metal, -0.45)}" stroke-width="${(0.02 * k).toFixed(2)}"/>`);
    const a = (sc.d / 2) * 0.55 * k;
    const t = Math.max(1, (sc.d / 9) * k);
    parts.push(`<path d="M${(sc.cx * k - a).toFixed(2)} ${(sc.cy * k).toFixed(2)} H${(sc.cx * k + a).toFixed(2)} M${(sc.cx * k).toFixed(2)} ${(sc.cy * k - a).toFixed(2)} V${(sc.cy * k + a).toFixed(2)}" stroke="${shade(metal, -0.6)}" stroke-width="${t.toFixed(2)}"/>`);
  }
  parts.push(`<path d="${layoutTextPath(layout, spec.font, k)}" fill="${metal}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

export async function renderFlatPng(layout: PlaqueLayout, spec: PlaqueSpec, opts: FlatOptions & { widthPx: number; heightPx: number }): Promise<Buffer> {
  const svg = layoutToSvg(layout, spec, opts);
  return sharp(Buffer.from(svg), { density: 72 })
    .resize(opts.widthPx, opts.heightPx, { fit: 'fill' })
    .png()
    .toBuffer();
}
