// Vector production file, built the way production_32241.ai is built:
//  - one page at the plaque's exact size (72 pt per inch)
//  - one ink: rich black #231F20 = raised metal, white = recessed paint-filled field
//  - all text converted to outlines (no fonts in the file), no raster images
//  - the photo area is an empty placeholder window inside a raised frame
//    (the relief / etch / print artwork is produced separately)
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { resolveFont } from '../text/fonts.js';
import { linePathData } from '../render/flat.js';
import sharp from 'sharp';
import { mustOption } from '../catalog.js';
import { traceLogo } from './trace.js';
import type { PlaqueLayout, PlaqueSpec, Rect } from '../../shared/types.js';

export const INK_HEX = '#231F20';
const INK = rgb(0x23 / 255, 0x1f / 255, 0x20 / 255);
const WHITE = rgb(1, 1, 1);
const PT = 72;

export interface ProductionInput {
  jobNumber: string;
  name: string;
  spec: PlaqueSpec;
  layout: PlaqueLayout;
  /** One entry per `layout.logos` box, in the same order. */
  logos?: ProductionLogo[];
  customFontFile?: string | null;
}

export interface ProductionLogo {
  /** Working PNG of the logo; null when the file is missing. */
  png: Buffer | null;
  /** File name as uploaded, for the notes. */
  name: string;
  /** Supplied as SVG / PDF / AI / EPS. */
  fromVector: boolean;
}

export interface ProductionResult {
  pdf: Buffer;
  fileName: string;
  notes: string[];
}

export function productionFileName(jobNumber: string, name: string, spec: PlaqueSpec) {
  const short = (name || 'plaque')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const fmt = (v: number) => String(+v.toFixed(3));
  return `${jobNumber || 'job'}_${short}_${fmt(spec.widthIn)}x${fmt(spec.heightIn)}_production.pdf`;
}

/** The raised plate of a UV printed logo: the logo plus its padding, fitted inside the logo box. */
export function uvPlateRect(box: Rect, logoAspect: number): Rect {
  const aspect = logoAspect > 0 ? logoAspect : 1;
  // Padding is a share of the logo, so the plate's aspect ratio is the logo's.
  const w = Math.min(box.w, box.h * aspect);
  const h = w / aspect;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export async function buildProductionPdf(input: ProductionInput): Promise<ProductionResult> {
  const { spec, layout } = input;
  const notes: string[] = [];
  const W = layout.widthIn * PT;
  const H = layout.heightIn * PT;
  const doc = await PDFDocument.create();
  doc.setTitle(`production ${input.jobNumber}`);
  doc.setCreator('Plaque Proof Studio - Impact Signs');
  doc.setProducer('Plaque Proof Studio');
  doc.setSubject(JSON.stringify({ jobNumber: input.jobNumber, spec, preset: layout.preset }));
  doc.setKeywords(['production', input.jobNumber, `${spec.widthIn}x${spec.heightIn}`]);
  const page = doc.addPage([W, H]);

  const rect = (r: Rect, color = INK, stroke?: number) =>
    page.drawRectangle({
      x: r.x * PT,
      y: H - (r.y + r.h) * PT,
      width: r.w * PT,
      height: r.h * PT,
      color,
      ...(stroke ? { borderColor: INK, borderWidth: stroke } : {}),
    });

  // Plate (raised) and field (recessed).
  rect({ x: 0, y: 0, w: layout.widthIn, h: layout.heightIn });
  rect(layout.field, WHITE);

  // Double line border: a raised inner line inside the field.
  if (layout.border.innerLine && layout.border.innerLineIn) {
    const t = layout.border.innerLineIn;
    const il = layout.border.innerLine;
    rect({ x: il.x - t / 2, y: il.y - t / 2, w: il.w + t, h: il.h + t });
    rect({ x: il.x + t / 2, y: il.y + t / 2, w: il.w - t, h: il.h - t }, WHITE);
  }
  if (!layout.border.verified) notes.push(`${layout.border.id} border geometry is not yet verified against a real production file.`);

  // Image frames: each a raised frame with an empty placeholder window (1.12 pt keyline as on the real file).
  for (const f of layout.imageFrames) {
    rect(f.outer, INK, 1.12);
    rect(f.inner, WHITE, 1.12);
  }

  // Logos, each centered in its own box: traced to raised outlines (raised cast), or drawn
  // as the raised plate the logo is printed on afterwards (UV print).
  const many = layout.logos.length > 1;
  const treatment = mustOption('logoTreatments', spec.logoTreatment ?? 'raised-cast');
  const uvPrint = treatment.mode !== 'raised';
  for (const [i, box] of layout.logos.entries()) {
    const logo = input.logos?.[i];
    const which = many ? `Logo ${i + 1}${logo?.name ? ` (${logo.name})` : ''}` : 'Logo';
    if (!logo?.png) {
      notes.push(`${which} position is reserved but no logo file was uploaded.`);
      continue;
    }
    if (uvPrint) {
      const image = await sharp(logo.png).metadata();
      const plate = uvPlateRect(box, image.width! / image.height!);
      rect(plate);
      notes.push(`${which}: ${treatment.label}. The raised plate (${+plate.w.toFixed(2)}" x ${+plate.h.toFixed(2)}") is in this file; the logo artwork is printed on it after casting, so it is not outlined here.`);
      continue;
    }
    const traced = await traceLogo(logo.png);
    const s = Math.min((box.w * PT) / traced.width, (box.h * PT) / traced.height);
    const ox = box.x * PT + (box.w * PT - traced.width * s) / 2;
    const oy = box.y * PT + (box.h * PT - traced.height * s) / 2;
    for (const p of traced.paths.filter((p) => p.dark)) {
      page.drawSvgPath(p.d, { x: ox, y: H - oy, scale: s, color: INK, borderWidth: 0 });
    }
    notes.push(
      traced.fromPlate
        ? `${which} was read from the marks on a plate or card in the picture (a photo of a finished plaque, for example). Check it against the original logo.`
        : logo.fromVector
          ? `${which} was traced from a high-resolution render of the vector file. Check it against the original.`
          : `${which} was traced from a raster image. Check its edges, or replace it with the vector original in Illustrator.`,
    );
  }

  // Section rules (raised).
  for (const r of layout.rules ?? []) rect(r);

  // Face screw / rosette holes: ink ring with a center mark.
  for (const sc of layout.screws ?? []) {
    page.drawCircle({ x: sc.cx * PT, y: H - sc.cy * PT, size: (sc.d / 2) * PT, color: WHITE, borderColor: INK, borderWidth: 1.12 });
    page.drawLine({ start: { x: sc.cx * PT - 3, y: H - sc.cy * PT }, end: { x: sc.cx * PT + 3, y: H - sc.cy * PT }, thickness: 0.75, color: INK });
    page.drawLine({ start: { x: sc.cx * PT, y: H - sc.cy * PT - 3 }, end: { x: sc.cx * PT, y: H - sc.cy * PT + 3 }, thickness: 0.75, color: INK });
  }
  if (layout.screws?.length) notes.push('Screw hole positions are marked; confirm hole size and countersink with production.');

  // Text as outlines.
  const { licensed, label } = resolveFont(spec.font, {}, input.customFontFile);
  if (!licensed) {
    notes.push(
      spec.font === 'custom'
        ? `Custom font "${spec.customFontName ?? ''}" was not uploaded; text was outlined with a stand-in. Upload the font file and rebuild.`
        : `${label} font file not found in brand-assets/fonts/; text was outlined with an open stand-in of the same proportions.`,
    );
  }
  drawText(page, layout, spec.font, H);

  const bytes = await doc.save({ useObjectStreams: false });
  return { pdf: Buffer.from(bytes), fileName: productionFileName(input.jobNumber, input.name, spec), notes };
}

function drawText(page: PDFPage, layout: PlaqueLayout, fontId: string, H: number) {
  for (const l of layout.lines) {
    const d = linePathData(l, fontId, PT);
    if (d) page.drawSvgPath(d, { x: 0, y: H, color: INK, borderWidth: 0 });
  }
}
