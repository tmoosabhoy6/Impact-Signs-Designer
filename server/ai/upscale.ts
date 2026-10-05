// AI Upscaler: enlarges a low-resolution image just enough to be usable (720p or 1080p)
// without changing what is in it. The image model sharpens a Lanczos enlargement of the
// original; the result is then checked against the original and, when it matches, its
// broad tones and colors are locked to the original so only fine detail comes from the AI.
// Separate from the plaque pipeline: it shares only the OpenAI client and the daily budget.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { toFile } from 'openai';
import type { ImageEditParamsBase, ImagesResponse } from 'openai/resources/images';
import { config } from '../config.js';
import { addSpend, newId, now, spentToday } from '../db.js';
import { costUsd, friendlyError, openai, withImageCompatibility, type ImageUsage } from './images.js';
import { MIN_SCALE, targetSize, type UpscaleFidelity, type UpscaleRecord, type UpscaleTarget } from '../../shared/upscale.js';

export { UPSCALE_TARGETS, targetSize, type UpscaleRecord, type UpscaleTarget } from '../../shared/upscale.js';
const MAX_INPUT_PIXELS = 40_000_000;

export const UPSCALE_PROMPT = `Upscale this image. This is a strict resolution enhancement of an existing picture, not an edit and not a redesign.

Reproduce exactly the same image at higher resolution:
- same framing, crop, composition and perspective; every edge stays exactly where it is;
- same people, faces, facial features, expressions, hair, skin, age and pose;
- same text, letters, numbers and logos, character for character;
- same colors, white balance, contrast, lighting, shadows, textures and background.

Do not add, remove, move, restyle, retouch, beautify or reinterpret anything. Do not smooth skin, change makeup, straighten lines or "improve" the content.

Only remove what the low resolution caused: blur, pixelation, JPEG blocks, jagged edges and noise. Render fine detail only where the original clearly shows it. Where a detail is unclear, keep it soft instead of inventing it. If text is unreadable, leave it as it is rather than guessing.`;

export function upscaleRoot(...p: string[]) {
  return path.join(config.dataDir, 'upscales', ...p);
}

export const isUpscaleId = (id: string) => /^up_[a-f0-9]+$/.test(id);

/** The canvas sent to the image model: same aspect (ratio clamped to 1:3..3:1), multiples of 16. */
export function modelCanvas(width: number, height: number, outLong: number) {
  const ratio = Math.min(3, Math.max(1 / 3, width / height));
  const long = Math.min(config.imageLongEdge, Math.max(1024, Math.ceil(outLong / 16) * 16));
  const r16 = (v: number) => Math.max(256, Math.round(v / 16) * 16);
  const w = ratio >= 1 ? r16(long) : r16(long * ratio);
  const h = ratio >= 1 ? r16(long / ratio) : r16(long);
  return { w, h, size: `${w}x${h}` };
}

export function describeFidelity(difference: number): UpscaleFidelity {
  const d = +difference.toFixed(2);
  const matchPct = +Math.max(0, 100 - (d / 255) * 100).toFixed(1);
  if (d <= 4) return { difference: d, matchPct, tone: 'ok', label: 'Matches the original closely.' };
  if (d <= 9) return { difference: d, matchPct, tone: 'amber', label: 'Close to the original, with small differences. Compare before using.' };
  return { difference: d, matchPct, tone: 'red', label: 'The AI changed parts of the image. Use the standard upscale instead, or compare carefully.' };
}

/** Mean absolute RGB difference after bringing `candidate` back down to the original's size. */
async function differenceFromOriginal(candidate: Buffer, original: Buffer, width: number, height: number): Promise<number> {
  const down = async (b: Buffer) =>
    sharp(b).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).blur(0.6).removeAlpha().raw().toBuffer();
  const [a, b] = await Promise.all([down(candidate), down(original)]);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** result = AI detail + (blurred standard − blurred AI): tones and colors follow the original. */
async function lockToOriginal(ai: Buffer, standard: Buffer, width: number, height: number, sigma: number): Promise<Buffer> {
  const raw = (b: Buffer) => sharp(b).removeAlpha().raw().toBuffer();
  const lowpass = (b: Buffer) => sharp(b).removeAlpha().blur(sigma).raw().toBuffer();
  const [a, aLow, sLow] = await Promise.all([raw(ai), lowpass(ai), lowpass(standard)]);
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(a[i] + sLow[i] - aLow[i])));
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function runModel(input: Buffer, size: string): Promise<{ png: Buffer; usage: ImageUsage | null }> {
  if (config.mockAI) {
    // Demo mode: a gentle sharpen of the enlargement. No network, no cost.
    const png = await sharp(input).sharpen({ sigma: 0.8 }).png().toBuffer();
    await new Promise((r) => setTimeout(r, 300));
    return { png, usage: null };
  }
  const file = await toFile(input, 'image.png', { type: 'image/png' });
  const res = await withImageCompatibility(
    {
      model: config.imageModel,
      image: [file],
      prompt: UPSCALE_PROMPT,
      size,
      quality: config.imageQuality as 'high',
      output_format: 'png',
      background: 'opaque',
      n: 1,
    },
    async (params) => {
      const send = (p: object) => openai().images.edit({ ...p, stream: false } as ImageEditParamsBase & { stream: false }) as Promise<ImagesResponse>;
      try {
        return await send({ ...params, input_fidelity: 'high' });
      } catch (e) {
        // Models without input fidelity reject the parameter; the prompt still asks for an exact copy.
        const err = e as { status?: number; param?: string; message?: string };
        if (err.status === 400 && (err.param === 'input_fidelity' || /input_fidelity/.test(err.message ?? ''))) return await send(params);
        throw e;
      }
    },
  );
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image.');
  return { png: Buffer.from(b64, 'base64'), usage: (res.usage as ImageUsage) ?? null };
}

export async function readImage(buffer: Buffer): Promise<{ png: Buffer; width: number; height: number; hasAlpha: boolean }> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new Error('That file is not an image this tool can read. Upload a PNG, JPG, WebP, TIFF or GIF.');
  }
  if (!meta.format || !['png', 'jpeg', 'webp', 'tiff', 'gif', 'avif', 'heif'].includes(meta.format)) {
    throw new Error('That file is not an image this tool can read. Upload a PNG, JPG, WebP, TIFF or GIF.');
  }
  // Apply the camera's rotation so the upscale faces the same way the photo is viewed.
  const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().png().toBuffer({ resolveWithObject: true });
  const hasAlpha = info.channels === 4 && (await sharp(data).stats()).channels[3].min < 255;
  return { png: data, width: info.width, height: info.height, hasAlpha };
}

/** Checks the image can be upscaled at this target; throws a plain-English reason if not. */
export function checkUpscale(width: number, height: number, target: UpscaleTarget) {
  const out = targetSize(width, height, target);
  if (out.scale < MIN_SCALE) {
    throw new Error(`This image is already ${width} × ${height} px, at least ${target}. It does not need upscaling.`);
  }
  if (!config.mockAI && spentToday() >= config.dailyBudgetUsd) {
    throw new Error(`Today's image budget of $${config.dailyBudgetUsd} is used up (DAILY_BUDGET_USD). It resets at midnight UTC.`);
  }
  return out;
}

export async function upscaleImage(file: { name: string; buffer: Buffer }, target: UpscaleTarget, createdBy: string, ownerId?: string): Promise<UpscaleRecord> {
  const t0 = Date.now();
  const src = await readImage(file.buffer);
  const out = checkUpscale(src.width, src.height, target);

  // The model sees the original enlarged to its canvas (flattened on white); extreme
  // aspect ratios are padded by repeating the edges and cropped back afterwards.
  const flat = await sharp(src.png).flatten({ background: '#ffffff' }).png().toBuffer();
  const canvas = modelCanvas(src.width, src.height, Math.max(out.width, out.height));
  const srcRatio = src.width / src.height;
  const canvasRatio = canvas.w / canvas.h;
  let inner = { w: canvas.w, h: canvas.h };
  if (srcRatio > canvasRatio * 1.02) inner = { w: canvas.w, h: Math.round(canvas.w / srcRatio) };
  else if (srcRatio < canvasRatio / 1.02) inner = { w: Math.round(canvas.h * srcRatio), h: canvas.h };
  const pad = { left: Math.floor((canvas.w - inner.w) / 2), top: Math.floor((canvas.h - inner.h) / 2) };
  const modelInput = await sharp(flat)
    .resize(inner.w, inner.h, { fit: 'fill', kernel: 'lanczos3' })
    .extend({ left: pad.left, right: canvas.w - inner.w - pad.left, top: pad.top, bottom: canvas.h - inner.h - pad.top, extendWith: 'copy' })
    .png()
    .toBuffer();

  let result: { png: Buffer; usage: ImageUsage | null };
  try {
    result = await runModel(modelInput, canvas.size);
  } catch (e) {
    throw new Error(friendlyError(e).replace(/^Image generation failed/, 'Upscaling failed'));
  }
  const cost = costUsd(result.usage);
  if (cost) addSpend(cost);

  // Back to the canvas, crop any padding, then to the exact output size.
  const aiCanvas = await sharp(result.png).removeAlpha().resize(canvas.w, canvas.h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const ai = await sharp(aiCanvas)
    .extract({ left: pad.left, top: pad.top, width: inner.w, height: inner.h })
    .resize(out.width, out.height, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const standardFlat = await sharp(flat).resize(out.width, out.height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();

  let final: Buffer = ai;
  let colorLocked = false;
  const rawDifference = await differenceFromOriginal(ai, flat, src.width, src.height);
  if (rawDifference <= 8) {
    // Only when the AI kept the layout: otherwise mixing the two would leave ghost edges.
    final = await lockToOriginal(ai, standardFlat, out.width, out.height, Math.max(0.5, out.scale * 0.5));
    colorLocked = true;
  }
  const fidelity = describeFidelity(await differenceFromOriginal(final, flat, src.width, src.height));

  // Transparent originals keep their own (smoothly enlarged) transparency.
  const standard = await sharp(src.png).resize(out.width, out.height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  if (src.hasAlpha) {
    // Separate pipelines: sharp applies removeAlpha after joinChannel within one.
    const alpha = await sharp(standard).extractChannel(3).raw().toBuffer();
    const rgb = await sharp(final).removeAlpha().raw().toBuffer();
    final = await sharp(rgb, { raw: { width: out.width, height: out.height, channels: 3 } })
      .joinChannel(alpha, { raw: { width: out.width, height: out.height, channels: 1 } })
      .png()
      .toBuffer();
  }

  const record: UpscaleRecord = {
    id: newId('up'),
    name: path.basename(file.name || 'image').replace(/\.[^.]+$/, '').slice(0, 80) || 'image',
    createdAt: now(),
    createdBy,
    ownerId,
    target,
    original: { width: src.width, height: src.height },
    output: { width: out.width, height: out.height },
    scale: +out.scale.toFixed(2),
    fidelity,
    colorLocked,
    hasAlpha: src.hasAlpha,
    model: config.mockAI ? 'mock (demo mode)' : config.imageModel,
    costUsd: cost,
    ms: Date.now() - t0,
  };
  const dir = upscaleRoot(record.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'original.png'), src.png);
  fs.writeFileSync(path.join(dir, 'upscaled.png'), final);
  fs.writeFileSync(path.join(dir, 'standard.png'), standard);
  fs.writeFileSync(path.join(dir, 'thumb.jpg'), await sharp(final).flatten({ background: '#ffffff' }).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 75 }).toBuffer());
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(record, null, 2));
  return record;
}

export function listUpscales(include: (r: UpscaleRecord) => boolean = () => true, limit = 30): UpscaleRecord[] {
  const root = upscaleRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter(isUpscaleId)
    .map((id) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8')) as UpscaleRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is UpscaleRecord => !!r && include(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function getUpscale(id: string): UpscaleRecord | null {
  if (!isUpscaleId(id)) return null;
  const f = upscaleRoot(id, 'meta.json');
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as UpscaleRecord) : null;
}

export function deleteUpscale(id: string) {
  if (isUpscaleId(id)) fs.rmSync(upscaleRoot(id), { recursive: true, force: true });
}
