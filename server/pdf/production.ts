// Vector production file, built the way production_32241.ai is built:
//  - one page at the plaque's exact size (72 pt per inch)
//  - one ink: rich black #231F20 = raised metal, white = recessed paint-filled field
//  - all text converted to outlines (no fonts in the file), no raster images
//  - the photo area is an empty placeholder window inside a raised frame
//    (the relief / etch / print artwork is produced separately)
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { resolveFont } from '../text/fonts.js';
import { linePathData } from '../render/flat.js';
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
  logoPng?: Buffer | null;
  logoFromVector?: boolean;
  customFontFile?: string | null;
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

  // Image frame: raised frame with an empty placeholder window (1.12 pt keyline as on the real file).
  if (layout.imageFrame) {
    rect(layout.imageFrame.outer, INK, 1.12);
    rect(layout.imageFrame.inner, WHITE, 1.12);
  }

  // Logo, traced to vector outlines.
  if (layout.logo) {
    if (input.logoPng) {
      const traced = await traceLogo(input.logoPng);
      const s = Math.min((layout.logo.w * PT) / traced.width, (layout.logo.h * PT) / traced.height);
      const ox = layout.logo.x * PT + (layout.logo.w * PT - traced.width * s) / 2;
      const oy = layout.logo.y * PT + (layout.logo.h * PT - traced.height * s) / 2;
      for (const p of traced.paths.filter((p) => p.dark)) {
        page.drawSvgPath(p.d, { x: ox, y: H - oy, scale: s, color: INK, borderWidth: 0 });
      }
      notes.push(
        input.logoFromVector
          ? 'Logo was traced from a high-resolution render of the vector file. Check it against the original.'
          : 'Logo was traced from a raster image. Check its edges, or replace it with the vector original in Illustrator.',
      );
    } else {
      notes.push('Logo position is reserved but no logo file was uploaded.');
    }
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
