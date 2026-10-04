// Flat, exact drawing of a plaque layout (SVG -> PNG).
// It is sent to the image model as the "layout reference": the model keeps every
// position and every letter, and only turns the flat drawing into real cast metal.
// It is also used as the stand-in concept image in mock mode.
import sharp from 'sharp';
import { mustOption } from '../catalog.js';
import { resolveFont, type OTFont } from '../text/fonts.js';
import type { PlaqueLayout, PlaqueSpec } from '../../shared/types.js';

export function textPathData(font: OTFont, text: string, cx: number, baseline: number, size: number): string {
  const w = font.getAdvanceWidth(text, size);
  return font.getPath(text, cx - w / 2, baseline, size).toPathData(3);
}

/** All text of a layout as one SVG path, in the given units per inch. */
export function layoutTextPath(layout: PlaqueLayout, fontId: string, unitsPerIn: number): string {
  const { font } = resolveFont(fontId);
  return layout.lines
    .map((l) => textPathData(font, l.text, l.cx * unitsPerIn, l.baseline * unitsPerIn, l.size * unitsPerIn))
    .join(' ');
}

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

export interface FlatOptions {
  pxPerIn: number;
  /** Prepared photo (already toned for the image option) as PNG. */
  photoPng?: Buffer | null;
  logoPng?: Buffer | null;
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

export function layoutToSvg(layout: PlaqueLayout, spec: PlaqueSpec, opts: FlatOptions): string {
  const k = opts.pxPerIn;
  const W = layout.widthIn * k;
  const H = layout.heightIn * k;
  const finish = mustOption('finishes', spec.finish);
  const paint = mustOption('backgroundColors', spec.backgroundColor);
  const metal = finish.hex ?? '#C49A6C';
  const field = paint.hex ?? '#231F20';
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
  if (layout.imageFrame) {
    const f = layout.imageFrame;
    parts.push(`<rect ${r(f.outer)} fill="${metal}"/>`);
    if (opts.photoPng) {
      parts.push(
        `<image ${r(f.inner)} preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${opts.photoPng.toString('base64')}"/>`,
      );
    } else {
      parts.push(`<rect ${r(f.inner)} fill="${shade(metal, -0.35)}"/>`);
    }
  }
  if (layout.logo) {
    if (opts.logoPng) {
      parts.push(`<image ${r(layout.logo)} preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${opts.logoPng.toString('base64')}"/>`);
    } else {
      parts.push(`<rect ${r(layout.logo)} fill="none" stroke="${metal}" stroke-dasharray="6 4" stroke-width="2"/>`);
    }
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
