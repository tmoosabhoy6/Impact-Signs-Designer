// Image model adapter. The real adapter calls OpenAI's Images API (images.edit with
// reference images, streamed so partial previews appear on screen). The mock adapter
// returns a shaded version of the layout drawing so the whole app can run without cost.
import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import { config } from '../config.js';
import type { RefImage } from './prompts.js';
import type { ImageEditParamsBase, ImageGenerateParamsBase } from 'openai/resources/images';

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
  size?: string;
  quality?: string;
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

function errorDetails(e: unknown): { status?: number; code?: string; param?: string; message: string } {
  if (!e || typeof e !== 'object') return { message: String(e) };
  const err = e as { status?: number; code?: string; param?: string; message?: string; error?: unknown; cause?: unknown };
  const nested = err.error && typeof err.error === 'object' ? err.error as typeof err : undefined;
  const cause = err.cause && typeof err.cause === 'object' ? err.cause as typeof err : undefined;
  return { status: err.status ?? nested?.status, code: err.code ?? nested?.code ?? cause?.code, param: err.param ?? nested?.param, message: nested?.message ?? err.message ?? cause?.message ?? 'Unknown error' };
}

const COMPATIBLE_PARAMS = ['partial_images', 'stream', 'background', 'quality', 'output_format', 'size'] as const;
type ImageParams = ImageEditParamsBase | ImageGenerateParamsBase;

/** Only a rejected optional parameter gets one retry; no retries after paid output. */
export async function withImageCompatibility<T>(params: ImageParams, send: (params: ImageParams) => Promise<T>): Promise<T> {
  try {
    return await send(params);
  } catch (e) {
    const err = errorDetails(e);
    if (err.status !== 400 || !/unknown|unsupported|not supported|invalid|not allowed|unrecognized/i.test(err.message + ' ' + err.code)) throw e;
    const param = COMPATIBLE_PARAMS.find((p) => err.param === p)
      ?? COMPATIBLE_PARAMS.find((p) => new RegExp(`\\b${p}\\b`).test(err.message));
    if (!param || params[param] === undefined) throw e;
    const retry = { ...params };
    if (param === 'size') {
      const [w, h] = String(params.size).split('x').map(Number);
      retry.size = w > h ? '1536x1024' : h > w ? '1024x1536' : '1024x1024';
      if (retry.size === params.size) delete retry.size;
    } else if (param === 'quality' && (params.quality === 'xhigh' || params.quality === 'max')) retry.quality = 'high';
    else delete retry[param];
    if (param === 'stream') delete retry.partial_images;
    console.info(`OpenAI image compatibility: ${param} ${retry[param] === undefined ? 'dropped' : `changed to ${retry[param]}`}. Retrying once.`);
    return await send(retry);
  }
}

/** Turns API errors into sentences a designer can act on. */
export function friendlyError(e: unknown): string {
  const err = errorDetails(e);
  const msg = (config.openaiKey ? err.message.split(config.openaiKey).join('[redacted key]') : err.message).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted key]');
  const code = err.code || '';
  const where = 'Fix it at platform.openai.com, then try again.';
  if (err?.status === 401) return 'OpenAI rejected the API key. Check OPENAI_API_KEY in the server settings (Render → Environment).';
  if (/organization must be verified|verify your organization|organization verification/i.test(msg)) {
    return `OpenAI needs your organization to be verified before it allows image models. Go to platform.openai.com → Settings → Organization → General → Verify Organization (takes a few minutes). ${where}`;
  }
  if (code === 'insufficient_quota' || /insufficient_quota|exceeded your current quota|billing/i.test(msg)) {
    return `The OpenAI account has no credit left. Add credit under platform.openai.com → Billing. ${where}`;
  }
  if (err?.status === 429) return 'OpenAI rate limit reached. Wait a minute and try again.';
  if (err.status === 403) return 'OpenAI denied this request. Check that the key’s project has permission to use the configured model.';
  if (err.status && err.status >= 500) return 'OpenAI is temporarily unavailable. Try again in a few minutes.';
  if (err.status === 400 && /unknown|unsupported|invalid|not supported/i.test(msg)) return `OpenAI could not accept the image settings after the compatibility retry. Check the configured quality and size. (${msg})`;
  if (code === 'moderation_blocked' || /safety|moderation/i.test(msg)) return `OpenAI's safety filter blocked this image: ${msg}`;
  if (err?.status === 404 || code === 'model_not_found' || /does not exist|do not have access|not have access to model/i.test(msg)) {
    return `The image model "${config.imageModel}" is not available to this API key. Check the model name (OPENAI_IMAGE_MODEL) and that the key's project has access to it. (${msg})`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|Connection error|fetch failed|timed out/i.test(msg + ' ' + code)) return 'Could not reach OpenAI from the server (network problem). Try again in a minute.';
  return `Image generation failed: ${msg}`;
}

/** One small, cheap generation used by Admin → System → "Run a test image". */
export async function testImage(): Promise<{ png: Buffer; ms: number; costUsd: number; model: string }> {
  const t0 = Date.now();
  if (config.mockAI) {
    const png = await sharp({ create: { width: 512, height: 512, channels: 3 as const, background: '#C49A6C' } }).png().toBuffer();
    return { png, ms: Date.now() - t0, costUsd: 0, model: 'mock (demo mode)' };
  }
  const res = await withImageCompatibility({
    model: config.imageModel,
    prompt:
      'Photorealistic, straight-on product photo of a small cast bronze plaque filling the frame: satin brushed bronze raised border and raised serif lettering reading exactly "IMPACT SIGNS TEST", on a recessed dark oxide leatherette-textured background.',
    size: '1024x1024',
    quality: 'low',
    n: 1,
    output_format: 'png',
  }, (params) => openai().images.generate({ ...params, stream: false } as ImageGenerateParamsBase & { stream: false }));
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image.');
  return { png: Buffer.from(b64, 'base64'), ms: Date.now() - t0, costUsd: costUsd((res.usage as ImageUsage) ?? null), model: config.imageModel };
}

const realAdapter: ImageAdapter = {
  name: 'openai',
  async run(req) {
    const files = await Promise.all(req.images.map((r) => toFile(r.file, r.name, { type: r.mime })));
    let delivered = false;
    return withImageCompatibility({
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
    }, async (params) => {
      try {
        const res = await openai().images.edit(params as ImageEditParamsBase);
        if (Symbol.asyncIterator in res) {
          let final: ImageResult | null = null;
          for await (const ev of res) {
            delivered = true;
            if (ev.type === 'image_edit.partial_image') req.onPartial?.(Buffer.from(ev.b64_json, 'base64'));
            else if (ev.type === 'image_edit.completed') final = { png: Buffer.from(ev.b64_json, 'base64'), usage: ev.usage as ImageUsage, size: ev.size, quality: ev.quality };
          }
          if (!final) throw new Error('The image model returned no image.');
          return final;
        }
        const b64 = res.data?.[0]?.b64_json;
        if (!b64) throw new Error('The image model returned no image.');
        const png = await sharp(Buffer.from(b64, 'base64')).png().toBuffer();
        const { width, height } = await sharp(png).metadata();
        return { png, usage: res.usage ?? null, size: `${width}x${height}`, quality: params.quality ?? 'auto' };
      } catch (e) {
        // Once a partial has arrived, the request may have incurred a charge.
        if (delivered) throw new Error(friendlyError(e));
        throw e;
      }
    });
  },
};

/** Mock: shades the layout drawing so it reads as a raised plaque. No network, no cost. */
const mockAdapter: ImageAdapter = {
  name: 'mock',
  async run(req) {
    // A new-layout edit shows the updated drawing (Image 2) so the change is visible in demo mode.
    const layout = (/NEW LAYOUT/.test(req.prompt) && req.images[1] ? req.images[1] : req.images[0]).file;
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
