// Vectorizer: turns a picture or PDF into a one-ink vector PDF (and SVG) with the same reader
// and tracer the production file uses for logos. Separate from jobs; files live in
// DATA_DIR/vectors/<id>/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument, rgb } from 'pdf-lib';
import { config } from './config.js';
import { newId, now } from './db.js';
import { pdfToPng } from './uploads.js';
import { inkMask, maskSvg, traceMask, TRACE_EDGE } from './pdf/trace.js';
import { VECTOR_DEFAULTS, VECTOR_WIDTH_LIMITS, type VectorOptions, type VectorRecord } from '../shared/vectorize.js';

export { VECTOR_DEFAULTS, type VectorOptions, type VectorRecord } from '../shared/vectorize.js';

/** The production ink. */
const INK = rgb(0x23 / 255, 0x1f / 255, 0x20 / 255);
const MAX_INPUT_PIXELS = 60_000_000;
export const VECTOR_FILES = ['result.pdf', 'result.svg', 'preview.png', 'thumb.jpg', 'source.png'] as const;
export type VectorFile = (typeof VECTOR_FILES)[number];

export function vectorRoot(...p: string[]) {
  return path.join(config.dataDir, 'vectors', ...p);
}
export const isVectorId = (id: string) => /^v_[a-f0-9]+$/.test(id);

/** Checks the options a page sends; anything missing takes its default. */
export function readVectorOptions(raw: Record<string, unknown> | undefined): VectorOptions {
  const o = { ...VECTOR_DEFAULTS };
  if (raw?.background === 'light' || raw?.background === 'dark' || raw?.background === 'auto') o.background = raw.background;
  const w = Number(raw?.widthIn);
  if (Number.isFinite(w) && w > 0) o.widthIn = Math.min(VECTOR_WIDTH_LIMITS.maxIn, Math.max(VECTOR_WIDTH_LIMITS.minIn, +w.toFixed(3)));
  return o;
}

/** Reads any file a designer might drop: image, SVG, PDF/AI/EPS (first page). */
async function readSource(file: { name: string; buffer: Buffer }): Promise<{ png: Buffer; kind: VectorRecord['source']['kind'] }> {
  const ext = path.extname(file.name).toLowerCase();
  if (!file.buffer.length) throw new Error(`${file.name} is empty.`);
  if (/\.(pdf|ai|eps)$/.test(ext)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pps-vec-'));
    try {
      const f = path.join(tmp, `source${ext}`);
      fs.writeFileSync(f, file.buffer);
      return { png: pdfToPng(f, 600), kind: 'pdf' };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (ext === '.svg' || /^\s*<(\?xml|svg)/i.test(file.buffer.subarray(0, 200).toString('utf8'))) {
    return { png: await sharp(file.buffer, { density: 600 }).png().toBuffer(), kind: 'svg' };
  }
  try {
    const meta = await sharp(file.buffer).metadata();
    if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_INPUT_PIXELS) throw new Error('too big');
    return { png: await sharp(file.buffer).rotate().png().toBuffer(), kind: 'image' };
  } catch (e) {
    if ((e as Error).message === 'too big') throw new Error(`${file.name} is larger than ${MAX_INPUT_PIXELS / 1e6} megapixels. Export a smaller copy.`);
    throw new Error(`${file.name} could not be read. Upload a PNG, JPG, WebP, TIFF, SVG or PDF.`);
  }
}

/** Traces the file and writes the record and its files. */
export async function vectorizeFile(file: { name: string; buffer: Buffer }, options: VectorOptions, createdBy: string, ownerId?: string): Promise<VectorRecord> {
  const t0 = Date.now();
  const { png, kind } = await readSource(file);
  const src = await sharp(png).metadata();
  if (!src.width || !src.height) throw new Error(`${file.name} has no visible size.`);
  // The tracer works at a fixed size; vector sources are rendered large enough for crisp curves.
  const mask = await inkMask(png, { background: options.background, plate: true }, kind === 'image' ? TRACE_EDGE : Math.max(TRACE_EDGE, 2400));
  // Always the finest trace: the outlines follow every edge the reader found.
  const paths = traceMask(mask, 'fine');
  const shapes = paths.filter((p) => p.dark);
  if (!shapes.length) throw new Error('Nothing to trace was found: the picture reads as one flat tone. Try the other background setting.');
  const widthIn = options.widthIn;
  const heightIn = +((widthIn * mask.height) / mask.width).toFixed(4);

  // One-ink PDF at the asked size: every shape is an outline, no fonts, no images.
  const doc = await PDFDocument.create();
  doc.setTitle(`vector ${file.name}`);
  doc.setCreator('Plaque Proof Studio - Impact Signs');
  doc.setProducer('Plaque Proof Studio');
  const W = widthIn * 72;
  const H = heightIn * 72;
  const page = doc.addPage([W, H]);
  const scale = W / mask.width;
  for (const p of shapes) page.drawSvgPath(p.d, { x: 0, y: H, scale, color: INK, borderWidth: 0 });
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));

  const svg = maskSvg(mask, paths, '#231F20');
  const ink = mask.data.reduce((a, b) => a + b, 0);
  const record: VectorRecord = {
    id: newId('v'),
    name: path.basename(file.name || 'artwork').replace(/\.[^.]+$/, '').slice(0, 80) || 'artwork',
    createdAt: now(),
    createdBy,
    ownerId,
    options,
    source: { width: src.width, height: src.height, kind },
    output: { widthIn, heightIn, shapes: shapes.length },
    fromPlate: mask.fromPlate,
    inkPct: +((100 * ink) / (mask.width * mask.height)).toFixed(1),
    ms: Date.now() - t0,
  };
  const dir = vectorRoot(record.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.pdf'), pdf);
  fs.writeFileSync(path.join(dir, 'result.svg'), svg);
  fs.writeFileSync(path.join(dir, 'source.png'), await sharp(png).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).png().toBuffer());
  const preview = await sharp(Buffer.from(svg)).resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: false }).flatten({ background: '#ffffff' }).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'preview.png'), preview);
  fs.writeFileSync(path.join(dir, 'thumb.jpg'), await sharp(preview).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 75 }).toBuffer());
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(record, null, 2));
  return record;
}

export function listVectors(include: (r: VectorRecord) => boolean = () => true, limit = 30): VectorRecord[] {
  const root = vectorRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter(isVectorId)
    .map((id) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8')) as VectorRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is VectorRecord => !!r && include(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function getVector(id: string): VectorRecord | null {
  if (!isVectorId(id)) return null;
  const f = vectorRoot(id, 'meta.json');
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as VectorRecord) : null;
}

export function deleteVector(id: string) {
  if (isVectorId(id)) fs.rmSync(vectorRoot(id), { recursive: true, force: true });
}
