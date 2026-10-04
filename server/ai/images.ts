// Image model adapter. The real adapter calls OpenAI's Images API (images.edit with
// reference images, streamed so partial previews appear on screen). The mock adapter
// returns a shaded version of the layout drawing so the whole app can run without cost.
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import { config } from '../config.js';
import type { RefImage } from './prompts.js';

export interface ImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

export interface ImageRequest {
  prompt: string;
  images: RefImage[];
  size: string;
  quality: string;
  onPartial?: (png: Buffer) => void;
}

export interface ImageResult {
  png: Buffer;
  usage: ImageUsage | null;
}

export interface ImageAdapter {
  name: string;
  run(req: ImageRequest): Promise<ImageResult>;
}

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is not set. Add it in the server settings.');
  if (!client) client = new OpenAI({ apiKey: config.openaiKey, timeout: 10 * 60 * 1000, maxRetries: 1 });
  return client;
}

export function costUsd(usage: ImageUsage | null): number {
  if (!usage) return 0;
  const text = usage.input_tokens_details?.text_tokens ?? 0;
  const image = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - text);
  const out = usage.output_tokens ?? 0;
  const p = config.prices;
  return (text * p.textIn + image * p.imageIn + out * p.imageOut) / 1_000_000;
}

/** Turns API errors into sentences a designer can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { status?: number; message?: string; error?: { message?: string; code?: string } };
  const msg = err?.error?.message || err?.message || String(e);
  if (err?.status === 401) return 'OpenAI rejected the API key. Check OPENAI_API_KEY in the server settings.';
  if (err?.status === 429) return 'OpenAI rate limit or quota reached. Wait a minute, or check the billing limits on the OpenAI account.';
  if (err?.status === 400 && /safety|moderation/i.test(msg)) return `OpenAI's safety filter blocked this image: ${msg}`;
  if (err?.status === 404) return `The image model "${config.imageModel}" is not available to this API key. (${msg})`;
  return `Image generation failed: ${msg}`;
}

const realAdapter: ImageAdapter = {
  name: 'openai',
  async run(req) {
    const files = await Promise.all(req.images.map((r) => toFile(r.file, r.name, { type: r.mime })));
    const stream = await openai().images.edit({
      model: config.imageModel,
      image: files,
      prompt: req.prompt,
      size: req.size,
      quality: req.quality as 'high',
      output_format: 'png',
      background: 'opaque',
      n: 1,
      stream: true,
      partial_images: 2,
    });
    let final: ImageResult | null = null;
    for await (const ev of stream) {
      if (ev.type === 'image_edit.partial_image') req.onPartial?.(Buffer.from(ev.b64_json, 'base64'));
      else if (ev.type === 'image_edit.completed') final = { png: Buffer.from(ev.b64_json, 'base64'), usage: ev.usage as ImageUsage };
    }
    if (!final) throw new Error('The image model returned no image.');
    return final;
  },
};

/** Mock: shades the layout drawing so it reads as a raised plaque. No network, no cost. */
const mockAdapter: ImageAdapter = {
  name: 'mock',
  async run(req) {
    const layout = req.images[0].file;
    const [w, h] = req.size.split('x').map(Number);
    const base = await sharp(layout).resize(w, h, { fit: 'fill' }).removeAlpha().png().toBuffer();
    // Emboss: light from upper-left, blended over the flat drawing.
    const emboss = await sharp(base)
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2], scale: 1, offset: 0 })
      .png()
      .toBuffer();
    const noise = await sharp({ create: { width: w, height: h, channels: 3 as const, background: '#808080', noise: { type: 'gaussian' as const, mean: 128, sigma: 10 } } }).png().toBuffer();
    const blurred = await sharp(base).blur(12).png().toBuffer();
    req.onPartial?.(blurred);
    await new Promise((r) => setTimeout(r, 400));
    const png = await sharp(base)
      .composite([
        { input: emboss, blend: 'soft-light' },
        { input: noise, blend: 'overlay' },
      ])
      .png()
      .toBuffer();
    return { png, usage: null };
  },
};

export function imageAdapter(): ImageAdapter {
  return config.mockAI ? mockAdapter : realAdapter;
}

/** Output canvas matching the plaque's proportions (multiples of 16, ratio clamped to 1:3..3:1). */
export function canvasSize(widthIn: number, heightIn: number, longEdge = config.imageLongEdge): { w: number; h: number; size: string } {
  const ratio = Math.min(3, Math.max(1 / 3, widthIn / heightIn));
  const r16 = (v: number) => Math.max(256, Math.round(v / 16) * 16);
  const w = ratio >= 1 ? r16(longEdge) : r16(longEdge * ratio);
  const h = ratio >= 1 ? r16(longEdge / ratio) : r16(longEdge);
  return { w, h, size: `${w}x${h}` };
}
